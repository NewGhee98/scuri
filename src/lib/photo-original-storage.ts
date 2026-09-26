import { clearDerivedCache } from "./photo-cache-storage";
import { fingerprintOriginal } from "./photo-fingerprint";
import { loadPhotoBlob, savePhotoBlob } from "./storage";

/** Detach a picker/provider File from its temporary backing file before any
 * asynchronous hashing, decoding or persistence. Only one file is copied at a time. */
export async function snapshotImportFile(file: File): Promise<File> {
  let bytes: ArrayBuffer;
  try { bytes = await file.arrayBuffer(); }
  catch { throw new Error("This selected file is no longer readable. Reselect the original in Photos or Files."); }
  if (bytes.byteLength !== file.size) throw new Error("The selected file was not read completely. Reselect the original.");
  return new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
}

/** A committed IndexedDB request alone does not prove its original is readable.
 * Keep the existing Blob store format; read back and verify the exact bytes before
 * the import queue publishes metadata or releases the selected file. */
export async function saveImportedOriginal(key: string, file: File, fingerprint: string): Promise<void> {
  const original = new Blob([file], { type: file.type });
  try { await savePhotoBlob(key, original); }
  catch { await clearDerivedCache(); await savePhotoBlob(key, original); }
  const saved = await loadPhotoBlob(key);
  if (!saved || saved.size !== file.size || await fingerprintOriginal(saved) !== fingerprint) {
    throw new Error("Device storage could not verify this original.");
  }
}
