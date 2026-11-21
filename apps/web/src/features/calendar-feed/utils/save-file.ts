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
  // Released after the click has been handled, never before.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
