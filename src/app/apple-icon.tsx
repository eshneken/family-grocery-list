import { ImageResponse } from "next/og";
import { GroceryAppIcon } from "@/lib/grocery-app-icon";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Generates the iOS-specific Home Screen icon at Apple's preferred 180px size. */
export default function AppleIcon() {
  return new ImageResponse(<GroceryAppIcon />, size);
}
