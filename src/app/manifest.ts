import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Family Grocery List",
    short_name: "Grocery",
    description: "Shared family grocery list with requestor and shopper flows",
    id: "/",
    start_url: "/list",
    scope: "/",
    display: "standalone",
    background_color: "#f7f8f4",
    theme_color: "#0f766e",
    icons: [{ src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" }]
  };
}
