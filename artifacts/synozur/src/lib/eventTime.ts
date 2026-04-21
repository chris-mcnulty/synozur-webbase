/**
 * An event is "upcoming" when its start date falls on or after the most
 * recent Monday 00:00 local time. That way a conference that started this
 * morning at 6 AM is still shown as upcoming for the rest of the week.
 */
export function startOfCurrentWeek(now: Date = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}
