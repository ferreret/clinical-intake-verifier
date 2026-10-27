import type { ReactNode } from "react";

import { SessionShell } from "../_ui/session";

export default function BatchesLayout({ children }: { children: ReactNode }) {
  return <SessionShell>{children}</SessionShell>;
}
