/**
 * Utility to extract all files from a DragEvent or DataTransfer, seamlessly supporting
 * individual files, multiple files, and directory folders (via WebKit FileSystem Entry API).
 */
export async function extractFilesFromDropEvent(e: React.DragEvent): Promise<File[]> {
  const items = e.dataTransfer.items;
  const collectedFiles: File[] = [];

  if (items && items.length > 0) {
    const readEntry = async (entry: any): Promise<void> => {
      if (!entry) return;
      if (entry.isFile) {
        return new Promise<void>((resolve) => {
          entry.file(
            (file: File) => {
              collectedFiles.push(file);
              resolve();
            },
            () => resolve()
          );
        });
      } else if (entry.isDirectory) {
        const dirReader = entry.createReader();
        return new Promise<void>((resolve) => {
          dirReader.readEntries(
            async (entries: any[]) => {
              const promises: Promise<void>[] = [];
              for (const child of entries) {
                if (child.isFile) {
                  promises.push(
                    new Promise<void>((res) => {
                      child.file(
                        (f: File) => {
                          collectedFiles.push(f);
                          res();
                        },
                        () => res()
                      );
                    })
                  );
                } else if (child.isDirectory) {
                  promises.push(readEntry(child));
                }
              }
              await Promise.all(promises);
              resolve();
            },
            () => resolve()
          );
        });
      }
    };

    const promises: Promise<void>[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) {
        promises.push(readEntry(entry));
      }
    }
    await Promise.all(promises);
  }

  // Fallback if webkitGetAsEntry didn't collect anything or was not available
  if (collectedFiles.length === 0 && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    for (let i = 0; i < e.dataTransfer.files.length; i++) {
      collectedFiles.push(e.dataTransfer.files[i]);
    }
  }

  return collectedFiles;
}
