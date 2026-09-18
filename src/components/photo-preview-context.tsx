"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { displayPagePhotos, EMPTY_PHOTO_PREVIEWS, type DisplayPhoto, type PhotoPreviewCache, type PreviewPage } from "@/lib/photo-preview-cache";

export interface PhotoPreviewSession {
  cache: PhotoPreviewCache;
  getDriveToken: () => string | null;
  getVolatileBlob: (key: string) => Blob | undefined;
  accessRevision: number;
}
export const PhotoPreviewContext = createContext<PhotoPreviewSession | null>(null);
const noSubscription = () => () => {};
const serverSnapshot = () => EMPTY_PHOTO_PREVIEWS;

export function usePhotoPreviewSession() {
  const session = useContext(PhotoPreviewContext);
  const snapshot = useSyncExternalStore(session?.cache.subscribe ?? noSubscription, session?.cache.getSnapshot ?? serverSnapshot, serverSnapshot);
  return { session, snapshot };
}

export function usePagePreviews(page: PreviewPage | null): Record<string, DisplayPhoto> {
  const { session, snapshot } = usePhotoPreviewSession();
  useEffect(() => {
    if (!session || !page) return;
    for (const photo of [...Object.values(page.photos), ...Object.values(page.unavailablePhotos ?? {})]) {
      void session.cache.request(photo, session.getDriveToken, key => page.photos[photo.frameId]?.blobKey === key
        ? page.photos[photo.frameId].sourceBlob : session.getVolatileBlob(key));
    }
  }, [page, session]);
  return useMemo(() => session ? displayPagePhotos(page, snapshot) : page?.photos ?? {}, [page, session, snapshot]);
}
