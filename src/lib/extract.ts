export interface Event {
  role: string;
  org: string;
  start_iso: string | null;
  end_iso: string | null;
  acad_year: string;
  ord: number;
}

export function extractEvents(page: any): Event[] {
  const text = page?.results?.[0]?.text || '';
  const lines = text.split(/\n+/);
  const events: Event[] = [];
  let ord = 0;
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      lower.includes('intern') ||
      lower.includes('research') ||
      lower.includes('offer')
    ) {
      events.push({
        role: line.trim(),
        org: 'unknown',
        start_iso: null,
        end_iso: null,
        acad_year: 'unknown',
        ord: ord++,
      });
    }
  }
  return events;
}

export function inferAcademicYear(_date: string, _gradYear: number): string {
  // stub: real logic later
  return 'unknown';
}
