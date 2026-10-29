/**
 * The technicians a visitor can work as. Picked on entering, not logged in (decision of
 * 2026-10-27): enough for the audit trail to say who approved what. Invented people.
 */
export interface Technician {
  id: string;
  name: string;
}

export const TECHNICIANS: readonly Technician[] = [
  { id: "T01", name: "Lucía Ferrer Ibáñez" },
  { id: "T02", name: "Marc Soler Vidal" },
  { id: "T03", name: "Elena Ruiz Navarro" },
];

/**
 * The header a page sends with the technician it shows. The technician cookie is shared by
 * every tab, so one tab picking another technician would otherwise make the others act as them
 * while still showing the first: their approvals recorded under the wrong name.
 */
export const ACTING_HEADER = "x-technician";

export function technician(id: string | null | undefined): Technician | null {
  return TECHNICIANS.find((t) => t.id === id) ?? null;
}
