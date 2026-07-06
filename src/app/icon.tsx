import { ImageResponse } from "next/og";
import { GroceryAppIcon } from "@/lib/grocery-app-icon";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/** Generates the high-resolution general-purpose PWA icon at request/build time. */
export default function Icon() {
  return new ImageResponse(<GroceryAppIcon />, size);
}
