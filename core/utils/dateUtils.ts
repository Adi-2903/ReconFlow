/**
 * Timezone normalization utility for metric calculations.
 * 
 * Why this exists:
 * Financial metrics must align to a specific day boundary in the tenant's localized 
 * timezone. A transaction occurring at 23:00 UTC might be recorded as the next day in Asia/Kolkata.
 * Normalizing this consistently is essential for accurate daily reporting.
 * 
 * Why both rebuilds and write-time updates must call this:
 * To ensure absolute consistency between real-time metric increments (write-time) and 
 * full metric rebuilds. By forcing both paths through this single source of truth,
 * we eliminate drift caused by subtle differences in date calculation logic or timezone handling.
 */

const DEFAULT_TIMEZONE = "Asia/Kolkata";

/**
 * Converts a Date into a YYYY-MM-DD string localized to the provided timezone.
 * Uses a fallback strategy to default to Asia/Kolkata if the timezone is missing or invalid.
 * 
 * @param date The date to format.
 * @param timezone The target timezone string (e.g., "America/New_York").
 * @returns The YYYY-MM-DD representation of the date in the specified timezone.
 */
export function toMetricDate(date: Date, timezone?: string | null): string {
    const tz = timezone || DEFAULT_TIMEZONE;
    
    try {
        return formatDateParts(date, tz);
    } catch (error) {
        // Fallback to default timezone if the provided timezone string is invalid
        return formatDateParts(date, DEFAULT_TIMEZONE);
    }
}

function formatDateParts(date: Date, tz: string): string {
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    
    const parts = formatter.formatToParts(date);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    
    return `${year}-${month}-${day}`;
}
