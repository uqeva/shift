# shift-landing (story 21.21; AD-28): Smjenko's public page, a static server
# that runs as uid 101 and never as root. Not shift-web: no SPA fallback, no
# service worker, its own strict policy.
#
# Build from the repository root, after `apps/landing` is built
# (`pnpm --filter @shift/landing build`, or `build:production` with the three
# LANDING_* inputs set; CI's `landing-image` job builds with placeholders and
# pushes nothing):
#
#   docker build -f deploy/landing/Dockerfile -t shift-landing:<sha> .
#
# The base is shift-web's: nginx-unprivileged's stable line on Alpine (uid 101,
# listens on 8080, pid and temp paths in /tmp), pinned by tag AND the same
# index digest. The image holds the built page, its stylesheet, fonts and
# icons, and its two config files: no source, no key, no address.
FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03

USER root

# The base's sample server and pages go; its nginx.conf stays.
RUN rm -rf /etc/nginx/conf.d/* /usr/share/nginx/html/*

COPY --chown=root:root deploy/landing/default.conf /etc/nginx/conf.d/default.conf
COPY --chown=root:root deploy/landing/security-headers.conf /etc/nginx/shift/security-headers.conf
COPY --chown=root:root apps/landing/dist/ /usr/share/nginx/html/

# A build that is not there, or not whole, is refused. Then root-owned and not
# writable by uid 101: the base leaves /etc/nginx and /var/cache/nginx to uid
# 101 (group-writable), and /var/tmp world-writable, which nothing here uses.
# Writes go to /tmp alone.
RUN test -f /usr/share/nginx/html/index.html \
 && test -f /usr/share/nginx/html/404.html \
 && test -n "$(find /usr/share/nginx/html/assets -name 'styles-*.css')" \
 && test -n "$(find /usr/share/nginx/html/assets -name 'outfit-latin-wght-normal-*.woff2')" \
 && test -n "$(find /usr/share/nginx/html/assets -name 'outfit-latin-ext-wght-normal-*.woff2')" \
 && test -f /usr/share/nginx/html/favicon.svg \
 && test -f /usr/share/nginx/html/favicon.ico \
 && test -f /usr/share/nginx/html/apple-touch-icon-180x180.png \
 && chown -R root:root /etc/nginx /var/cache/nginx /usr/share/nginx/html \
 && chmod -R go-w /etc/nginx /var/cache/nginx /usr/share/nginx/html \
 && chmod -R a+rX /usr/share/nginx/html /etc/nginx/shift \
 && chmod 0755 /var/tmp

# The config is checked at build, as root (a build step's stderr is root's);
# the temp directories `-t` makes in /tmp go with it.
RUN nginx -t && rm -rf /tmp/*

USER 101

EXPOSE 8080

# The base's busybox wget, on the container's own loopback: no curl needed.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
