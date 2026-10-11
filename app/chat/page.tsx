import { redirect } from "next/navigation";
// The chat now lives inside the workflow editor (docked panel). This old prototype page just sends people home.
export default function ChatPage() { redirect("/"); }
