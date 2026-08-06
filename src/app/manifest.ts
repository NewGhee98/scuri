import type { MetadataRoute } from "next";
import { PRODUCT } from "@/config/product";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PRODUCT.name,
    short_name: PRODUCT.shortName,
    description: PRODUCT.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f5f5f2",
    theme_color: "#f5f5f2",
    categories: ["photo", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
