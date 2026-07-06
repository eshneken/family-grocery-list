import { redirect } from "next/navigation";

/** Sends the root route to the list, the application's primary starting screen. */
export default function HomePage() {
  redirect("/list");
}
