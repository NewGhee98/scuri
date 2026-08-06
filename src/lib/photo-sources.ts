export interface PhotoSourceDefinition {
  id: string;
  name: string;
  accept: string;
  kind: "local-picker";
}

/**
 * V1 deliberately exposes one on-device source. A future Google Photos picker
 * can implement a separate source without changing the crop or export layers.
 */
export const LOCAL_PHOTO_SOURCE: PhotoSourceDefinition = {
  id: "local-device",
  name: "Photos or Files",
  accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
  kind: "local-picker",
};
