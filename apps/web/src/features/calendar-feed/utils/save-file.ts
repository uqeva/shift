/** How long the object URL outlives the click: FileSaver's 40 s, rounded up. */
export const OBJECT_URL_LIFETIME_MS = 60_000;

/**
 * Hands the browser a text file to save (story 16.5's month download): an
 * object URL on a one-off link, clicked once and released. The browser's own
 * download, with no server call and no dependency.
 */
export function saveTextFile(fileName: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Released well after the click: some browsers (Safari, an installed
  // app) read the object URL only once the download has begun, and a release
  // on the next tick can cancel it.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, OBJECT_URL_LIFETIME_MS);
}
