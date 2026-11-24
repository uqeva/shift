#!/usr/bin/env bash
# Stories 20.7 and 20.8: a stack's backups, its restore drill, and the on-host
# checks that tell the founder when something stopped. DEPLOY.md §9.12 and
# §9.13 are the runbook; read them before running anything here.
#
#   shift-ops.sh backup <env> [--manual <label>]  write a backup set (the timer's job)
#   shift-ops.sh drill <env> [<set directory>]    restore a set into a throwaway database
#   shift-ops.sh jobs-check <env>                 cron jobs, pg_net answers, backup age
#   shift-ops.sh list <env>                       the sets on this host
#   shift-ops.sh prune <directory> <keep>         keep the newest <keep> complete sets
#   shift-ops.sh config <env>                     the effective configuration
#   shift-ops.sh alert <unit>                     the OnFailure hook (shift-alert@.service)
#   shift-ops.sh install <env> [--no-jobs-check]  install the tool and its timers (root)
#   shift-ops.sh copy-counts                      rows per table, from `pg_restore -f -` text on stdin
#
# <env> names a stack (`staging`, `production`); its settings are
# /etc/shift-ops/<env>.env, KEY=VALUE data that is read, never sourced
# (ops.env.example lists every key).
#
# Safety:
# - Read-only towards the stack. The dump and the roles are taken with the
#   database container's own pg_dump/pg_dumpall through `docker exec`, the
#   volumes are read from their mount points, and every check runs in a
#   read-only transaction. No stack container is ever stopped or changed.
# - A set is written as `.partial-<name>` and renamed when complete, so an
#   interrupted run never counts as a backup and never makes retention delete
#   a good one. Directories are 0700 and files 0600, root's.
# - Role passwords never enter a set (`--no-role-passwords`), and neither does
#   Coolify's APP_KEY. A set DOES hold pgsodium's root key (the db-config
#   volume): it decrypts Vault, so a set is as secret as the database itself.
# - The drill restores into a container it creates, with no network, under a
#   name of its own, and removes it and its volume however it ends. It never
#   restores into a running stack.
set -euo pipefail
umask 077
export LC_ALL=C

readonly SELF="${BASH_SOURCE[0]}"
SELF_DIR="$(cd -- "$(dirname -- "$SELF")" && pwd)"
readonly SELF_DIR
readonly ETC_DIR=${SHIFT_OPS_ETC:-/etc/shift-ops}
readonly INSTALLED_BIN=/usr/local/sbin/shift-ops
readonly SHARE_DIR=/usr/local/share/shift-ops
readonly UNIT_DIR=/etc/systemd/system
readonly LOCK_DIR=${SHIFT_OPS_LOCK_DIR:-/run/lock}
readonly STATE_DIR=${SHIFT_OPS_STATE:-/var/lib/shift-ops}
readonly DB_USER=supabase_admin
readonly SET_NAME_RE='^[0-9]{8}T[0-9]{6}Z(-[a-z0-9][a-z0-9-]{0,39})?$'
readonly SOURCES=(
  systemd/shift-backup@.service systemd/shift-backup@.timer
  systemd/shift-jobs-check@.service systemd/shift-jobs-check@.timer
  systemd/shift-alert@.service ops.env.example alert-hook.example
)

die() {
  printf 'shift-ops: %s\n' "$*" >&2
  LAST_ERROR=$*
  exit 1
}
LAST_ERROR=""
say() { printf '%s\n' "$*"; }

# SHIFT_OPS_ALLOW_NONROOT=1 is for test/host-ops.test.ts only (a stub docker,
# scratch directories); on a host every command that writes runs as root.
need_root() { [[ $(id -u) -eq 0 || ${SHIFT_OPS_ALLOW_NONROOT:-} == 1 ]] || die "run as root"; }

# ------------------------------------------------------------------- config

is_env_name() { [[ $1 =~ ^[a-z][a-z0-9-]{0,30}$ ]]; }
is_count() { [[ $1 =~ ^[0-9]{1,4}$ ]] && ((10#$1 >= 1)); }

load_config() {
  ENV_NAME=$1
  is_env_name "$ENV_NAME" || die "not an environment name: $ENV_NAME"
  local file=$ETC_DIR/$ENV_NAME.env
  [[ -f $file ]] || die "no configuration at $file (copy ops.env.example there, mode 0600)"
  # Run as root, the file decides what root deletes (BACKUP_DIR): it must be
  # root's, and writable by nobody else.
  if [[ $(id -u) -eq 0 ]]; then
    [[ $(stat -c '%u' "$file") == 0 ]] || die "$file is not root's"
    if (($(stat -c '%#a' "$file") & 8#022)); then die "$file is writable by others"; fi
  fi

  SERVICE_UUID=""
  DB_CONTAINER=""
  BACKUP_VOLUMES="supabase-db-config supabase-storage-data"
  BACKUP_DIR=/var/backups/shift/$ENV_NAME
  KEEP_DAILY=7
  KEEP_WEEKLY=4
  KEEP_MANUAL=5
  WEEKLY_DAY=7
  BACKUP_TZ=Europe/Zagreb
  OFFSITE=off
  RCLONE_REMOTE=""
  RCLONE_CONFIG=$ETC_DIR/rclone.conf
  DRILL_MEMORY=1g
  JOBS="notify:10 remind:20 housekeeping:1560"
  JOBS_WINDOW_MINUTES=20
  JOBS_MAX_FAILED_CALLS=2
  BACKUP_MAX_AGE_HOURS=26
  DISK_MAX_PERCENT=85
  ALERT_REPEAT_HOURS=6

  # KEY=VALUE lines only, known keys only: the file is read, never sourced.
  local line key value
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[[:space:]]*(#|$) ]] && continue
    [[ $line =~ ^([A-Z0-9_]+)=(.*)$ ]] || die "$file: not KEY=VALUE: $line"
    key=${BASH_REMATCH[1]}
    value=${BASH_REMATCH[2]}
    case $key in
      SERVICE_UUID | DB_CONTAINER | BACKUP_VOLUMES | BACKUP_DIR | KEEP_DAILY | KEEP_WEEKLY | \
        KEEP_MANUAL | WEEKLY_DAY | BACKUP_TZ | OFFSITE | RCLONE_REMOTE | RCLONE_CONFIG | \
        DRILL_MEMORY | JOBS | JOBS_WINDOW_MINUTES | JOBS_MAX_FAILED_CALLS | \
        BACKUP_MAX_AGE_HOURS | DISK_MAX_PERCENT | ALERT_REPEAT_HOURS)
        printf -v "$key" '%s' "$value"
        ;;
      *) die "$file: unknown key $key" ;;
    esac
  done <"$file"
  validate_config "$file"
}

validate_config() {
  local file=$1 item
  [[ $SERVICE_UUID =~ ^[a-z0-9]{8,64}$ ]] || die "$file: SERVICE_UUID must be Coolify's service id (lowercase letters and digits)"
  [[ -n $DB_CONTAINER ]] || DB_CONTAINER=supabase-db-$SERVICE_UUID
  [[ $DB_CONTAINER =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || die "$file: DB_CONTAINER is not a container name"
  for item in $BACKUP_VOLUMES; do
    [[ $item =~ ^[a-z0-9][a-z0-9_-]{0,63}$ ]] || die "$file: BACKUP_VOLUMES: not a volume suffix: $item"
  done
  [[ $BACKUP_DIR =~ ^/[A-Za-z0-9._/-]+$ && $BACKUP_DIR != *..* && $BACKUP_DIR != / ]] ||
    die "$file: BACKUP_DIR must be an absolute path"
  is_count "$KEEP_DAILY" || die "$file: KEEP_DAILY must be at least 1"
  is_count "$KEEP_WEEKLY" || die "$file: KEEP_WEEKLY must be at least 1"
  is_count "$KEEP_MANUAL" || die "$file: KEEP_MANUAL must be at least 1"
  [[ $WEEKLY_DAY =~ ^[1-7]$ ]] || die "$file: WEEKLY_DAY is 1 (Monday) to 7 (Sunday)"
  [[ $BACKUP_TZ =~ ^[A-Za-z_]+(/[A-Za-z_+-]+)*$ && -f /usr/share/zoneinfo/$BACKUP_TZ ]] ||
    die "$file: BACKUP_TZ is not a time zone name"
  case $OFFSITE in
    off) ;;
    rclone)
      [[ $RCLONE_REMOTE =~ ^[A-Za-z0-9_-]+:[A-Za-z0-9._/-]*$ && $RCLONE_REMOTE != *..* ]] ||
        die "$file: OFFSITE=rclone needs RCLONE_REMOTE as <remote>:<bucket>/<path>"
      [[ $RCLONE_CONFIG =~ ^/[A-Za-z0-9._/-]+$ ]] || die "$file: RCLONE_CONFIG must be an absolute path"
      ;;
    *) die "$file: OFFSITE is off or rclone" ;;
  esac
  [[ $DRILL_MEMORY =~ ^[0-9]{1,5}[mg]$ ]] || die "$file: DRILL_MEMORY is like 1g or 768m"
  for item in $JOBS; do
    if ! [[ $item =~ ^[a-z_][a-z0-9_-]{0,62}:[0-9]{1,6}$ ]] || ((10#${item##*:} < 1)); then
      die "$file: JOBS: not <job>:<minutes, at least 1>: $item"
    fi
  done
  is_count "$JOBS_WINDOW_MINUTES" || die "$file: JOBS_WINDOW_MINUTES must be at least 1"
  is_count "$JOBS_MAX_FAILED_CALLS" || die "$file: JOBS_MAX_FAILED_CALLS must be at least 1"
  [[ $BACKUP_MAX_AGE_HOURS =~ ^[0-9]{1,4}$ ]] || die "$file: BACKUP_MAX_AGE_HOURS is a number (0: not checked)"
  [[ $DISK_MAX_PERCENT =~ ^[0-9]{1,2}$ ]] || die "$file: DISK_MAX_PERCENT is 0 (not checked) to 99"
  is_count "$ALERT_REPEAT_HOURS" || die "$file: ALERT_REPEAT_HOURS must be at least 1"
}

show_config() {
  say "environment            $ENV_NAME"
  say "database container     $DB_CONTAINER"
  say "volumes                $(volume_names)"
  say "backup directory       $BACKUP_DIR"
  say "kept                   $KEEP_DAILY daily, $KEEP_WEEKLY weekly (day $WEEKLY_DAY, $BACKUP_TZ), $KEEP_MANUAL manual"
  if [[ $OFFSITE == rclone ]]; then
    say "off-site               rclone to $RCLONE_REMOTE (config $RCLONE_CONFIG)"
  else
    say "off-site               off"
  fi
  say "jobs checked           $JOBS (minutes since the last success)"
  say "failed calls           at most $((10#$JOBS_MAX_FAILED_CALLS - 1)) in $JOBS_WINDOW_MINUTES minutes"
  say "backup max age         ${BACKUP_MAX_AGE_HOURS}h (0: not checked)"
  say "disk                   at most ${DISK_MAX_PERCENT}% used (0: not checked)"
  say "repeated alert         every ${ALERT_REPEAT_HOURS}h while the same checks fail"
  say "alert hook             $ETC_DIR/alert-hook (if present)"
}

volume_names() {
  local suffix names=()
  for suffix in $BACKUP_VOLUMES; do names+=("${SERVICE_UUID}_$suffix"); done
  printf '%s\n' "${names[*]}"
}

# ------------------------------------------------------------------ helpers

# The backup waits up to 30 minutes for a drill to finish; anything else
# refuses at once.
take_lock() {
  local wait=${1:-0} file=$LOCK_DIR/shift-ops-$ENV_NAME.lock
  exec 9>"$file"
  flock -w "$wait" 9 || die "another shift-ops run holds $file"
}

need_db() {
  command -v docker >/dev/null || die "docker is not installed"
  [[ $(docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null || true) == true ]] ||
    die "the database container $DB_CONTAINER is not running"
}

# psql in the stack's database container, in a read-only transaction.
psql_ro() {
  docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' "$DB_CONTAINER" \
    psql -X -q -U "$DB_USER" -d postgres -At -v ON_ERROR_STOP=1 "$@"
}

# Rows per table from `pg_restore --data-only -f -` text: one `COPY t (…) FROM
# stdin;` block per table, one line per row (COPY's text format escapes every
# newline inside a value), ended by `\.`. Sorted `table<TAB>count`.
copy_counts() {
  awk '
    inside && $0 == "\\." { print table "\t" rows; inside = 0; next }
    inside { rows++; next }
    /^COPY .* FROM stdin;$/ {
      table = $0
      sub(/^COPY /, "", table)
      sub(/ \(.*\) FROM stdin;$/, "", table)
      sub(/ +FROM stdin;$/, "", table)
      rows = 0
      inside = 1
    }
  ' | sort
}

is_set_name() { [[ $1 =~ $SET_NAME_RE ]]; }

# The complete sets in a directory, oldest first (the names sort by time).
complete_sets() {
  local dir=$1 entry
  [[ -d $dir ]] || return 0
  for entry in "$dir"/*; do
    [[ -d $entry && -f $entry/SHA256SUMS ]] || continue
    if is_set_name "$(basename -- "$entry")"; then printf '%s\n' "$entry"; fi
  done | sort
}

prune() {
  local dir=$1 keep=$2 sets count
  is_count "$keep" || die "keep must be at least 1"
  [[ -d $dir ]] || return 0
  mapfile -t sets < <(complete_sets "$dir")
  count=${#sets[@]}
  local index
  for ((index = 0; index < count - keep; index++)); do
    say "pruned $(basename -- "$(dirname -- "${sets[$index]}")")/$(basename -- "${sets[$index]}")"
    rm -rf -- "${sets[$index]}"
  done
}

# Percent used of the filesystem holding a path.
disk_used() { df -P -- "$1" | awk 'NR == 2 { sub(/%/, "", $5); print $5 }'; }

# pg_restore of the set's own image, in a container of its own with no
# network: reading a dump never loads the live database's container.
restore_tool() {
  local image=$1
  shift
  docker run --rm -i --network none --entrypoint pg_restore "$image" "$@"
}

stamp_epoch() {
  local name=${1%%-*}
  date -u -d "${name:0:4}-${name:4:2}-${name:6:2}T${name:9:2}:${name:11:2}:${name:13:2}Z" +%s
}

# ------------------------------------------------------------------- backup

PARTIAL=""
cleanup_partial() {
  if [[ -n $PARTIAL && -d $PARTIAL ]]; then
    rm -rf -- "$PARTIAL"
  fi
}

do_backup() {
  local label=$1 kind=daily name stamp dir image suffix mountpoint status
  need_root
  take_lock 1800
  need_db
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  name=$stamp
  if [[ -n $label ]]; then
    [[ $label =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]] || die "a label is lowercase letters, digits and dashes"
    kind=manual
    name=$stamp-$label
  fi
  dir=$BACKUP_DIR/$kind
  install -d -m 0700 "$BACKUP_DIR" "$dir"
  [[ ! -e $dir/$name ]] || die "a set $kind/$name already exists"
  # A run killed outright (a timeout, an OOM kill, a reboot) leaves its
  # partial set behind; under the lock, every partial is such a leftover.
  local leftover
  for leftover in "$BACKUP_DIR"/{daily,weekly,manual}/.partial-*; do
    [[ -d $leftover ]] || continue
    say "removed an interrupted set: $(basename -- "$(dirname -- "$leftover")")/$(basename -- "$leftover")"
    rm -rf -- "$leftover"
  done
  if ((10#$DISK_MAX_PERCENT > 0)) && (($(disk_used "$BACKUP_DIR") >= 95)); then
    die "the disk holding $BACKUP_DIR is 95% full or more; no set written"
  fi
  PARTIAL=$dir/.partial-$name
  trap cleanup_partial EXIT
  install -d -m 0700 "$PARTIAL"

  local image_id
  image=$(docker inspect -f '{{.Config.Image}}' "$DB_CONTAINER")
  image_id=$(docker inspect -f '{{.Image}}' "$DB_CONTAINER")
  # `timeout` inside the container: a pg_dump outliving the unit's own
  # timeout would hold its snapshot in the database's container.
  docker exec "$DB_CONTAINER" timeout 3000 pg_dump -U "$DB_USER" -d postgres -Fc >"$PARTIAL/db.dump" ||
    die "pg_dump failed; no set written"
  docker exec "$DB_CONTAINER" timeout 300 pg_dumpall -U "$DB_USER" --roles-only --no-role-passwords >"$PARTIAL/roles.sql" ||
    die "pg_dumpall failed; no set written"
  # The dump's catalog reads back, and its rows are counted from the dump
  # itself, by the same image in a container of its own.
  restore_tool "$image_id" -l <"$PARTIAL/db.dump" >/dev/null || die "the dump does not read back"
  restore_tool "$image_id" --data-only -f - <"$PARTIAL/db.dump" | copy_counts >"$PARTIAL/row-counts.tsv"
  [[ -s $PARTIAL/row-counts.tsv ]] || die "the dump holds no table data"

  for suffix in $BACKUP_VOLUMES; do
    mountpoint=$(docker volume inspect -f '{{.Mountpoint}}' "${SERVICE_UUID}_$suffix") ||
      die "no volume ${SERVICE_UUID}_$suffix"
    status=0
    tar --numeric-owner -C "$mountpoint" -czf "$PARTIAL/$suffix.tar.gz" . || status=$?
    # GNU tar: 1 means a file changed while it was read (a logo uploaded
    # meanwhile); the archive is still usable. Anything else is a failure.
    ((status <= 1)) || die "tar of ${SERVICE_UUID}_$suffix failed ($status)"
    ((status == 0)) || say "warning: a file in $suffix changed while it was read"
  done

  local tables rows server latest
  tables=$(wc -l <"$PARTIAL/row-counts.tsv")
  rows=$(awk -F'\t' '{ total += $2 } END { print total + 0 }' "$PARTIAL/row-counts.tsv")
  server=$(psql_ro -c 'show server_version')
  latest=$(psql_ro -c "select coalesce(max(version), 'none') from supabase_migrations.schema_migrations" 2>/dev/null || echo unknown)
  {
    say "environment=$ENV_NAME"
    say "kind=$kind"
    say "created_utc=$stamp"
    say "db_image=$image"
    say "db_image_id=$image_id"
    say "server_version=$server"
    say "latest_migration=$latest"
    say "tables=$tables"
    say "rows=$rows"
    say "volumes=$BACKUP_VOLUMES"
  } >"$PARTIAL/MANIFEST"
  (cd "$PARTIAL" && sha256sum -- * >SHA256SUMS.tmp && mv SHA256SUMS.tmp SHA256SUMS)
  chmod 0600 "$PARTIAL"/*
  mv -T -- "$PARTIAL" "$dir/$name"
  PARTIAL=""
  say "backup $ENV_NAME $kind/$name: $tables tables, $rows rows, $(du -sh "$dir/$name" | cut -f1)"
  if [[ $kind == manual ]]; then
    # The value DEPLOY.md §8.2 step 6 asks for, ready to paste.
    say "PRE_MIGRATION_BACKUP_AT=${stamp:0:4}-${stamp:4:2}-${stamp:6:2}T${stamp:9:2}:${stamp:11:2}Z"
  fi

  if [[ $kind == daily ]]; then
    weekly_copy "$dir/$name"
    prune "$dir" "$KEEP_DAILY"
    prune "$BACKUP_DIR/weekly" "$KEEP_WEEKLY"
  else
    prune "$dir" "$KEEP_MANUAL"
  fi
  offsite_copy "$kind" "$dir/$name"
}

# The configured weekday's daily set is also kept as a weekly one (hard links:
# no second copy on disk), once per day; so is any daily set when the newest
# weekly one is a week old (the weekday's run failed or was missed).
weekly_copy() {
  local set=$1 name day weekly epoch newest
  name=$(basename -- "$set")
  epoch=$(stamp_epoch "$name")
  day=$(TZ=$BACKUP_TZ date -d "@$epoch" +%u)
  weekly=$BACKUP_DIR/weekly
  install -d -m 0700 "$weekly"
  newest=$(complete_sets "$weekly" | tail -n 1)
  if [[ $day != "$WEEKLY_DAY" ]]; then
    [[ -n $newest ]] || return 0
    ((epoch - $(stamp_epoch "$(basename -- "$newest")") >= 7 * 86400 - 3600)) || return 0
  fi
  local local_date existing
  local_date=$(TZ=$BACKUP_TZ date -d "@$epoch" +%F)
  while IFS= read -r existing; do
    [[ -n $existing ]] || continue
    if [[ $(TZ=$BACKUP_TZ date -d "@$(stamp_epoch "$(basename -- "$existing")")" +%F) == "$local_date" ]]; then
      return 0
    fi
  done < <(complete_sets "$weekly")
  cp -al -- "$set" "$weekly/.partial-$name"
  mv -T -- "$weekly/.partial-$name" "$weekly/$name"
  say "weekly $name"
}

# The off-host copy: a second step, off until a credential exists (H-11). The
# host only ever adds (`--immutable`): retention off the host is the bucket's
# lifecycle rule, and its key should be one that cannot delete.
offsite_copy() {
  local kind=$1 set=$2
  [[ $OFFSITE == rclone ]] || return 0
  command -v rclone >/dev/null || die "OFFSITE=rclone but rclone is not installed; the local set is kept"
  [[ -f $RCLONE_CONFIG ]] || die "OFFSITE=rclone but $RCLONE_CONFIG does not exist; the local set is kept"
  rclone --config "$RCLONE_CONFIG" copy --immutable --no-traverse "$set" "$RCLONE_REMOTE/$kind/$(basename -- "$set")" ||
    die "the off-site copy failed; the local set is kept"
  say "off-site $kind/$(basename -- "$set")"
}

do_list() {
  local kind set
  for kind in daily weekly manual; do
    while IFS= read -r set; do
      [[ -n $set ]] || continue
      say "$kind/$(basename -- "$set")  $(du -sh "$set" | cut -f1)  $(grep -E '^(rows|latest_migration)=' "$set/MANIFEST" | tr '\n' ' ')"
    done < <(complete_sets "$BACKUP_DIR/$kind")
  done
  if [[ -f $BACKUP_DIR/drills.log ]]; then
    say "last drill: $(tail -n 1 "$BACKUP_DIR/drills.log")"
  fi
}

# -------------------------------------------------------------------- drill

DRILL_CONTAINER=""
DRILL_VOLUME=""
DRILL_SCRATCH=""
DRILL_SET=""
DRILL_STARTED=""
DRILL_RECORDED=""
cleanup_drill() {
  if [[ -n $DRILL_SET && -z $DRILL_RECORDED ]]; then
    record_drill "$DRILL_SET" "$DRILL_STARTED" FAIL "${LAST_ERROR:-stopped}" || true
  fi
  if [[ -n $DRILL_CONTAINER ]]; then docker rm -f -v "$DRILL_CONTAINER" >/dev/null 2>&1 || true; fi
  if [[ -n $DRILL_VOLUME ]]; then docker volume rm "$DRILL_VOLUME" >/dev/null 2>&1 || true; fi
  if [[ -n $DRILL_SCRATCH && -d $DRILL_SCRATCH ]]; then rm -rf -- "$DRILL_SCRATCH"; fi
}

drill_psql() {
  docker exec -i "$DRILL_CONTAINER" psql -X -q -U "$DB_USER" -d postgres -At -v ON_ERROR_STOP=1 "$@"
}

do_drill() {
  local set=$1 started image stamp
  need_root
  take_lock
  command -v docker >/dev/null || die "docker is not installed"
  if [[ -z $set ]]; then
    set=$(complete_sets "$BACKUP_DIR/daily" | tail -n 1)
    [[ -n $set ]] || die "no complete daily set in $BACKUP_DIR/daily"
  fi
  [[ -d $set ]] || die "no such set: $set"
  set=$(cd -- "$set" && pwd)
  is_set_name "$(basename -- "$set")" || die "$set is not a backup set"
  started=$(date +%s)
  # From here on, every way out writes its result to drills.log.
  DRILL_SET=$set
  DRILL_STARTED=$started
  DRILL_SCRATCH=$(mktemp -d)
  trap cleanup_drill EXIT
  [[ -f $set/SHA256SUMS && -f $set/MANIFEST && -f $set/db.dump && -f $set/roles.sql ]] ||
    die "$set is incomplete"
  (cd "$set" && sha256sum --quiet -c SHA256SUMS) || die "$set does not match its SHA256SUMS"
  local archive
  for archive in "$set"/*.tar.gz; do
    [[ -f $archive ]] || continue
    tar -tzf "$archive" >/dev/null || die "$(basename -- "$archive") does not read back"
  done
  image=$(sed -n 's/^db_image=//p' "$set/MANIFEST")
  [[ $image =~ ^[A-Za-z0-9][A-Za-z0-9./:_@-]{0,199}$ ]] || die "$set/MANIFEST names no database image"
  # The exact image the dump came from, when this host still has it.
  local image_id
  image_id=$(sed -n 's/^db_image_id=//p' "$set/MANIFEST")
  if [[ $image_id =~ ^sha256:[0-9a-f]{64}$ ]] && docker image inspect "$image_id" >/dev/null 2>&1; then
    image=$image_id
  elif [[ -n $image_id ]]; then
    say "warning: the set's image $image_id is gone from this host; using $image as tagged now"
  fi

  stamp=$(date -u +%Y%m%dt%H%M%Sz)
  DRILL_CONTAINER=shift-drill-$ENV_NAME-$stamp
  DRILL_VOLUME=$DRILL_CONTAINER-config
  say "drill $ENV_NAME: $(basename -- "$(dirname -- "$set")")/$(basename -- "$set") into $DRILL_CONTAINER ($image, no network)"

  # The set's db-config volume (pgsodium's root key) goes in before the first
  # start, so the restored Vault is readable with the key it was written under.
  docker volume create "$DRILL_VOLUME" >/dev/null
  if [[ -f $set/supabase-db-config.tar.gz ]]; then
    docker run --rm --network none -v "$DRILL_VOLUME:/dst" -v "$set:/src:ro" --entrypoint tar "$image" \
      --numeric-owner -xzf /src/supabase-db-config.tar.gz -C /dst
  else
    say "warning: no db-config in the set; Vault will not decrypt (DEPLOY.md §3a/§3b re-create its secrets)"
  fi

  # A throwaway password, never on a command line; nothing can reach the
  # container anyway (no network).
  printf 'POSTGRES_PASSWORD=%s\n' "$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')" >"$DRILL_SCRATCH/env"
  docker run -d --name "$DRILL_CONTAINER" --network none --memory "$DRILL_MEMORY" \
    --label shift-ops.drill="$ENV_NAME" --env-file "$DRILL_SCRATCH/env" \
    -e POSTGRES_HOST=/var/run/postgresql -e PGPORT=5432 -e POSTGRES_PORT=5432 \
    -e POSTGRES_DB=postgres -e PGDATABASE=postgres \
    -v "$DRILL_VOLUME:/etc/postgresql-custom" "$image" \
    postgres -c config_file=/etc/postgresql/postgresql.conf -c log_min_messages=fatal \
    -c cron.launch_active_jobs=off >/dev/null
  rm -f -- "$DRILL_SCRATCH/env"

  # The image's first start runs its init on a socket-only server; the TCP
  # loopback answers only once the real server is up.
  local waited=0
  until docker exec "$DRILL_CONTAINER" pg_isready -q -U postgres -h 127.0.0.1 2>/dev/null; do
    [[ $(docker inspect -f '{{.State.Running}}' "$DRILL_CONTAINER") == true ]] || die "the drill database stopped during its start"
    ((waited < 180)) || die "the drill database did not start in 180s"
    sleep 2
    waited=$((waited + 2))
  done
  [[ $(drill_psql -c 'show cron.launch_active_jobs') == off ]] || die "pg_cron would run the restored jobs"

  # Roles first (pg_dump has none); the image's own already exist.
  drill_psql -v ON_ERROR_STOP=0 <"$set/roles.sql" >/dev/null 2>"$DRILL_SCRATCH/roles.err" || true
  if grep -E 'ERROR' "$DRILL_SCRATCH/roles.err" | grep -vqE 'role "[^"]+" already exists'; then
    grep -E 'ERROR' "$DRILL_SCRATCH/roles.err" | grep -vE 'already exists' | head -n 5 >&2
    die "the roles did not restore"
  fi
  docker exec -i "$DRILL_CONTAINER" pg_restore -U "$DB_USER" -d postgres --clean --if-exists --exit-on-error \
    <"$set/db.dump" || die "pg_restore failed"

  # Every table's rows, against the dump's own count and the set's record.
  docker exec -i "$DRILL_CONTAINER" pg_restore --data-only -f - <"$set/db.dump" | copy_counts >"$DRILL_SCRATCH/expected.tsv"
  [[ -s $DRILL_SCRATCH/expected.tsv ]] || die "the dump holds no table data"
  cmp -s "$DRILL_SCRATCH/expected.tsv" "$set/row-counts.tsv" || die "the dump's rows differ from the set's row-counts.tsv"
  awk -F'\t' 'BEGIN { first = 1 }
    { printf "%sselect %s, count(*) from %s\n", first ? "" : "union all ", "$q$" $1 "$q$", $1; first = 0 }
    END { print ";" }' "$DRILL_SCRATCH/expected.tsv" >"$DRILL_SCRATCH/counts.sql"
  drill_psql -F $'\t' <"$DRILL_SCRATCH/counts.sql" | sort >"$DRILL_SCRATCH/restored.tsv"
  if ! cmp -s "$DRILL_SCRATCH/expected.tsv" "$DRILL_SCRATCH/restored.tsv"; then
    diff "$DRILL_SCRATCH/expected.tsv" "$DRILL_SCRATCH/restored.tsv" | head -n 20 >&2 || true
    die "row counts differ after the restore"
  fi

  # Vault: every secret decrypts with the restored key (counted, never read out).
  local vault total readable
  vault=$(drill_psql -c "select count(*) || '/' || count(decrypted_secret) from vault.decrypted_secrets")
  total=${vault%/*}
  readable=${vault#*/}
  if [[ $total != "$readable" ]]; then
    LAST_ERROR="vault $vault"
    die "Vault: only $readable of $total secrets decrypt; restore the set's db-config, or re-create them (DEPLOY.md §3a, §3b)"
  fi

  local tables rows
  tables=$(wc -l <"$DRILL_SCRATCH/restored.tsv")
  rows=$(awk -F'\t' '{ total += $2 } END { print total + 0 }' "$DRILL_SCRATCH/restored.tsv")
  record_drill "$set" "$started" PASS "tables=$tables rows=$rows vault=$vault"
  say "drill PASS: $tables tables and $rows rows equal the dump's; Vault $vault decrypt; $(($(date +%s) - started))s"
}

record_drill() {
  local set=$1 started=$2 result=$3 detail=$4
  DRILL_RECORDED=yes
  install -d -m 0700 "$BACKUP_DIR"
  printf '%s set=%s/%s result=%s %s seconds=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$(basename -- "$(dirname -- "$set")")" "$(basename -- "$set")" "$result" "$detail" \
    "$(($(date +%s) - started))" >>"$BACKUP_DIR/drills.log"
  chmod 0600 "$BACKUP_DIR/drills.log"
}

# --------------------------------------------------------------- jobs-check

do_jobs_check() {
  local failures=() item job limit row active status message age since uptime
  need_root
  need_db
  # How long the database has been up: a long job that has never run is only
  # noted until the database has been up longer than its limit.
  uptime=$(psql_ro -c 'select extract(epoch from now() - pg_postmaster_start_time())::bigint') ||
    die "the database did not answer"
  for item in $JOBS; do
    job=${item%%:*}
    limit=${item##*:}
    row=$(psql_ro <<SQL
select j.active,
       coalesce(last.status, 'none'),
       coalesce(extract(epoch from now() - ok.at)::bigint::text, 'never'),
       coalesce(regexp_replace(left(last.return_message, 300), '\s+', ' ', 'g'), '')
  from cron.job j
  left join lateral (select status, return_message from cron.job_run_details d
                      where d.jobid = j.jobid order by start_time desc limit 1) last on true
  left join lateral (select max(start_time) as at from cron.job_run_details d
                      where d.jobid = j.jobid and status = 'succeeded') ok on true
 where j.jobname = '$job'
 order by j.jobid limit 1;
SQL
    ) || die "the database did not answer"
    if [[ -z $row ]]; then
      failures+=("job $job: not scheduled")
      continue
    fi
    IFS='|' read -r active status age message <<<"$row"
    if [[ $active != t ]]; then
      failures+=("job $job: inactive")
    elif [[ $status == failed ]]; then
      failures+=("job $job: its last run failed: $message")
    elif [[ $age == never ]]; then
      if [[ $status != failed ]] && ((uptime <= 10#$limit * 60)); then
        say "NOTE job $job: no successful run yet (last run: $status)"
      else
        failures+=("job $job: no successful run recorded")
      fi
    elif ((age > 10#$limit * 60)); then
      failures+=("job $job: last success $((age / 60)) minutes ago (limit $limit)")
    else
      say "OK   job $job: last success $((age / 60)) minutes ago, last run $status"
    fi
  done

  # The cron jobs' HTTP calls (notify, remind): pg_net keeps each answer for
  # six hours. Only the status and the body's `code` are shown.
  local calls count
  calls=$(psql_ro <<SQL
select answer || ' x' || count(*)
  from (select coalesce(status_code::text, 'none') || ' ' ||
               coalesce(substring(content from '"code":"([A-Z_]+)"'),
                        case when timed_out then 'TIMED_OUT'
                             when error_msg is not null then 'NETWORK_ERROR' else '-' end) as answer
          from net._http_response
         where created > now() - interval '$JOBS_WINDOW_MINUTES minutes'
           and (status_code is distinct from 200 or timed_out or error_msg is not null)) failed
 group by answer order by answer;
SQL
  ) || die "the database did not answer"
  count=$(psql_ro -c "select count(*) from net._http_response where created > now() - interval '$JOBS_WINDOW_MINUTES minutes' and (status_code is distinct from 200 or timed_out or error_msg is not null)") ||
    die "the database did not answer"
  if ((count >= 10#$JOBS_MAX_FAILED_CALLS)); then
    failures+=("calls: $count failed in the last $JOBS_WINDOW_MINUTES minutes: $(tr '\n' ';' <<<"$calls")")
  else
    say "OK   calls: $count failed in the last $JOBS_WINDOW_MINUTES minutes"
  fi

  if ((10#$BACKUP_MAX_AGE_HOURS > 0)); then
    local newest
    newest=$(complete_sets "$BACKUP_DIR/daily" | tail -n 1)
    if [[ -z $newest ]]; then
      failures+=("backup: no daily set in $BACKUP_DIR/daily")
    else
      since=$(($(date -u +%s) - $(stamp_epoch "$(basename -- "$newest")")))
      if ((since > 10#$BACKUP_MAX_AGE_HOURS * 3600)); then
        failures+=("backup: the newest daily set is $((since / 3600)) hours old")
      else
        say "OK   backup: the newest daily set is $((since / 3600)) hours old"
      fi
    fi
  fi

  # The disk under the backups and under Docker (Postgres stops first when
  # it fills).
  if ((10#$DISK_MAX_PERCENT > 0)); then
    local path used
    for path in "$BACKUP_DIR" /var/lib/docker; do
      [[ -e $path ]] || continue
      used=$(disk_used "$path")
      if ((used > 10#$DISK_MAX_PERCENT)); then
        failures+=("disk: $used% used under $path (limit $DISK_MAX_PERCENT%)")
      else
        say "OK   disk: $used% used under $path"
      fi
    done
  fi

  report_failures "${failures[@]}"
}

# Fail (and so alert) when the failing checks change, and again every
# ALERT_REPEAT_HOURS while they stay the same; in between, the run says so and
# succeeds. When they clear, the hook hears the recovery once.
report_failures() {
  local state=$STATE_DIR/$ENV_NAME.jobs-check line signature previous="" alerted=0 now
  now=$(date -u +%s)
  install -d -m 0700 "$STATE_DIR"
  if [[ -f $state ]]; then
    previous=$(sed -n '1p' "$state")
    alerted=$(sed -n '2p' "$state")
    [[ $alerted =~ ^[0-9]+$ ]] || alerted=0
  fi
  if (($# == 0)); then
    rm -f -- "$state"
    if [[ -n $previous ]]; then
      say "RECOVERED: every check of $ENV_NAME passes again"
      run_hook "shift-jobs-check@$ENV_NAME.service" "RECOVERED: every check of $ENV_NAME passes again" || true
    fi
    return 0
  fi
  for line in "$@"; do say "FAIL $line"; done
  # The checks that fail, without their changing numbers.
  signature=$(printf '%s\n' "$@" | sed -E 's/[0-9]+//g' | sha256sum | cut -c1-16)
  if [[ $signature == "$previous" ]] && ((now - alerted < 10#$ALERT_REPEAT_HOURS * 3600)); then
    say "still failing as alerted at $(date -u -d "@$alerted" +%H:%MZ); the next reminder within ${ALERT_REPEAT_HOURS}h"
    return 0
  fi
  printf '%s\n%s\n' "$signature" "$now" >"$state"
  die "$# check(s) failed for $ENV_NAME"
}

# -------------------------------------------------------------------- alert

# shift-alert@<unit>.service runs this when a unit fails (OnFailure). The
# failure is always in the journal; delivering it is the hook's job: an
# executable file the founder writes (alert-hook.example), root's and not
# writable by anyone else. It gets the unit's name as its argument and the
# unit's last journal lines on stdin.
do_alert() {
  local unit=$1
  [[ $unit =~ ^[A-Za-z0-9@:._-]{1,200}$ ]] || die "not a unit name: $unit"
  printf '<3>SHIFT_ALERT %s failed\n' "$unit" >&2
  run_hook "$unit" "$({ journalctl -u "$unit" -n 30 --no-pager -o cat 2>/dev/null || true; })"
}

# The founder's hook, with the unit's name and a body on stdin. It holds a
# credential, so it must be root's and closed to everyone else (0700).
run_hook() {
  local unit=$1 body=$2 hook=$ETC_DIR/alert-hook
  if [[ ! -e $hook ]]; then
    say "no alert hook at $hook: this is only in the journal (DEPLOY.md §9.13)"
    return 0
  fi
  [[ -f $hook && -x $hook ]] || die "$hook is not an executable file"
  [[ $(stat -c '%u' "$hook") == 0 ]] || die "$hook is not root's"
  if (($(stat -c '%#a' "$hook") & 8#077)); then die "$hook is open to others (make it 0700)"; fi
  printf '%s\n' "$body" | timeout 60 "$hook" "$unit" || die "the alert hook failed"
}

# ------------------------------------------------------------------ install

do_install() {
  local with_jobs=$1 source
  need_root
  for source in "${SOURCES[@]}"; do
    [[ -f $SELF_DIR/$source ]] || die "missing $SELF_DIR/$source (run from the repository's deploy/host)"
  done
  [[ -f $ETC_DIR/$ENV_NAME.env ]] || die "write $ETC_DIR/$ENV_NAME.env first (from ops.env.example)"
  install -d -m 0700 "$ETC_DIR"
  chmod 0600 "$ETC_DIR/$ENV_NAME.env"
  install -m 0755 "$SELF" "$INSTALLED_BIN"
  install -d -m 0755 "$SHARE_DIR"
  install -m 0644 "$SELF_DIR/ops.env.example" "$SELF_DIR/alert-hook.example" "$SHARE_DIR/"
  for source in "${SOURCES[@]}"; do
    if [[ $source == systemd/* ]]; then install -m 0644 "$SELF_DIR/$source" "$UNIT_DIR/"; fi
  done
  install -d -m 0700 "$BACKUP_DIR"
  systemctl daemon-reload
  systemctl enable --now "shift-backup@$ENV_NAME.timer"
  if [[ $with_jobs == yes ]]; then
    systemctl enable --now "shift-jobs-check@$ENV_NAME.timer"
  else
    systemctl disable --now "shift-jobs-check@$ENV_NAME.timer" 2>/dev/null || true
  fi
  systemctl list-timers --no-pager "shift-*@$ENV_NAME.timer"
}

# --------------------------------------------------------------------- main

main() {
  [[ $# -ge 1 ]] || {
    sed -n '5,15p' "$SELF" | sed 's/^# \{0,1\}//'
    exit 2
  }
  local command=$1
  shift
  case $command in
    backup)
      [[ $# -eq 1 || ($# -eq 3 && $2 == --manual && -n $3) ]] || die "usage: backup <env> [--manual <label>]"
      load_config "$1"
      do_backup "${3:-}"
      ;;
    drill)
      [[ $# -eq 1 || $# -eq 2 ]] || die "usage: drill <env> [<set directory>]"
      load_config "$1"
      do_drill "${2:-}"
      ;;
    jobs-check)
      [[ $# -eq 1 ]] || die "usage: jobs-check <env>"
      load_config "$1"
      do_jobs_check
      ;;
    list)
      [[ $# -eq 1 ]] || die "usage: list <env>"
      load_config "$1"
      do_list
      ;;
    prune)
      [[ $# -eq 2 ]] || die "usage: prune <directory> <keep>"
      prune "$1" "$2"
      ;;
    config)
      [[ $# -eq 1 ]] || die "usage: config <env>"
      load_config "$1"
      show_config
      ;;
    alert)
      [[ $# -eq 1 ]] || die "usage: alert <unit>"
      do_alert "$1"
      ;;
    install)
      [[ $# -eq 1 || ($# -eq 2 && $2 == --no-jobs-check) ]] || die "usage: install <env> [--no-jobs-check]"
      load_config "$1"
      if [[ $# -eq 2 ]]; then do_install no; else do_install yes; fi
      ;;
    copy-counts)
      [[ $# -eq 0 ]] || die "usage: copy-counts < pg_restore text"
      copy_counts
      ;;
    *) die "unknown command: $command" ;;
  esac
}

main "$@"
