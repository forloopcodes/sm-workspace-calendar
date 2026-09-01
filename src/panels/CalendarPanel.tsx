import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styled, { css } from "styled-components";
import {
  Button,
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  Icon,
  IconButton,
  Input,
  Select,
  TextArea,
  Toggle,
  UserAvatar,
  EDITOR_SPACING,
  t,
  toast,
  useContextMenu,
  useCurrentUser,
  useGlobalPersistedState,
} from "@soft-machine/sdk";
import {
  type CalendarAttendee,
  type CalendarDefinition,
  type CalendarEvent,
  type EventTone,
  type RecurrenceFrequency,
  useCalendar,
} from "../CalendarContext";

type ScheduleMode = "day" | "three" | "week" | "twelve";
type ViewMode = ScheduleMode | "month" | "agenda";

interface EventDraft {
  id?: string;
  title: string;
  date: string;
  endDate: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  tone: EventTone;
  location: string;
  notes: string;
  reminderMinutes: number;
  calendarId: string;
  timezone: string;
  attendees: string;
  attendeeStatuses: Record<string, CalendarAttendee["status"]>;
  repeat: "none" | RecurrenceFrequency;
  repeatUntil: string;
  repeatInterval: number;
  repeatWeekdays: number[];
  seriesId?: string;
  editScope: "occurrence" | "future" | "series";
}

const HOUR_HEIGHT = 56;
const START_HOUR = 6;
const END_HOUR = 24;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VIEW_LENGTH: Record<ScheduleMode, number> = {
  day: 1,
  three: 3,
  week: 7,
  twelve: 12,
};
const TIMEZONES = [
  Intl.DateTimeFormat().resolvedOptions().timeZone,
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
].filter((value, index, values) => value && values.indexOf(value) === index);

function atNoon(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
}

function addDays(date: Date, amount: number) {
  const next = atNoon(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
}

function addMonthsClamped(date: Date, amount: number) {
  const target = new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(date.getDate(), lastDay));
  return target;
}

function startOfWeek(date: Date) {
  const day = (date.getDay() + 6) % 7;
  return addDays(date, -day);
}

function toDayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDayKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function timeOf(iso: string) {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function dayOf(iso: string) {
  return toDayKey(new Date(iso));
}

function formatHour(hour: number) {
  if (hour === 0 || hour === 24) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function formatTime(iso: string, timezone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(iso));
}

function formatMinutesOfDay(minutes: number) {
  const date = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function clockValue(minutes: number) {
  const bounded = Math.max(0, Math.min(24 * 60 - 1, minutes));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

function defaultDraft(date = new Date(), hour = Math.max(START_HOUR, new Date().getHours() + 1)): EventDraft {
  const start = Math.min(hour, 22);
  const repeatUntil = addMonthsClamped(date, 3);
  return {
    title: "",
    date: toDayKey(date),
    endDate: toDayKey(date),
    startTime: `${String(start).padStart(2, "0")}:00`,
    endTime: `${String(start + 1).padStart(2, "0")}:00`,
    allDay: false,
    tone: "accent",
    location: "",
    notes: "",
    reminderMinutes: 10,
    calendarId: "default",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    attendees: "",
    attendeeStatuses: {},
    repeat: "none",
    repeatUntil: toDayKey(repeatUntil),
    repeatInterval: 1,
    repeatWeekdays: [date.getDay()],
    editScope: "occurrence",
  };
}

function rangeDraft(date: Date, startMinutes: number, endMinutes: number): EventDraft {
  return {
    ...defaultDraft(date),
    startTime: clockValue(startMinutes),
    endTime: clockValue(endMinutes),
  };
}

function dateRangeDraft(start: Date, end: Date): EventDraft {
  const first = start <= end ? start : end;
  const last = start <= end ? end : start;
  return {
    ...defaultDraft(first),
    endDate: toDayKey(last),
    allDay: true,
  };
}

function draftFromEvent(event: CalendarEvent): EventDraft {
  return {
    id: event.id,
    title: event.title,
    date: dayOf(event.start),
    endDate: dayOf(event.end),
    startTime: timeOf(event.start),
    endTime: timeOf(event.end),
    allDay: event.allDay,
    tone: event.tone,
    location: event.location,
    notes: event.notes,
    reminderMinutes: event.reminderMinutes,
    calendarId: event.calendarId ?? "default",
    timezone: event.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    attendees: (event.attendees ?? []).map((attendee) => attendee.email).join(", "),
    attendeeStatuses: Object.fromEntries((event.attendees ?? []).map((attendee) => [attendee.email, attendee.status])),
    repeat: event.recurrence?.frequency ?? "none",
    repeatUntil: event.recurrence?.until ?? dayOf(event.end),
    repeatInterval: event.recurrence?.interval ?? 1,
    repeatWeekdays: event.recurrence?.weekdays ?? [new Date(event.start).getDay()],
    seriesId: event.seriesId,
    editScope: "occurrence",
  };
}

function storedEventPayload(event: CalendarEvent): Omit<CalendarEvent, "id" | "createdAt" | "createdBy"> {
  const { id: _id, createdAt: _createdAt, createdBy: _createdBy, ...payload } = event;
  return payload;
}

function eventPayload(draft: EventDraft) {
  return {
    title: draft.title.trim(),
    start: `${draft.date}T${draft.allDay ? "00:00" : draft.startTime}:00`,
    end: `${draft.endDate}T${draft.allDay ? "23:59" : draft.endTime}:00`,
    allDay: draft.allDay,
    tone: draft.tone,
    location: draft.location.trim(),
    notes: draft.notes.trim(),
    reminderMinutes: draft.reminderMinutes,
    calendarId: draft.calendarId,
    timezone: draft.timezone,
    attendees: draft.attendees
      .split(",")
      .map((email) => email.trim().toLocaleLowerCase())
      .filter(Boolean)
      .map((email): CalendarAttendee => ({ email, status: draft.attendeeStatuses[email] ?? "pending" })),
    ...(draft.seriesId ? { seriesId: draft.seriesId } : {}),
    ...(draft.repeat !== "none"
      ? {
          recurrence: {
            frequency: draft.repeat,
            until: draft.repeatUntil,
            interval: Math.max(1, draft.repeatInterval),
            weekdays: draft.repeat === "weekly" ? draft.repeatWeekdays : undefined,
          },
        }
      : {}),
  };
}

function parseNaturalLanguageDraft(draft: EventDraft): EventDraft {
  let title = draft.title;
  let date = fromDayKey(draft.date);
  let startMinutes: number | null = null;
  let endMinutes: number | null = null;

  const relative = title.match(/\b(today|tomorrow)\b/i);
  if (relative) {
    date = addDays(new Date(), relative[1].toLocaleLowerCase() === "tomorrow" ? 1 : 0);
    title = title.replace(relative[0], "");
  } else {
    const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const weekday = weekdayNames.findIndex((name) => new RegExp(`\\b(?:next\\s+)?${name}\\b`, "i").test(title));
    if (weekday >= 0) {
      const delta = (weekday - new Date().getDay() + 7) % 7 || 7;
      date = addDays(new Date(), delta);
      title = title.replace(new RegExp(`\\b(?:next\\s+)?${weekdayNames[weekday]}\\b`, "i"), "");
    }
  }

  const timeMatch = title.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*(?:-|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (timeMatch && (timeMatch[2] || timeMatch[3] || timeMatch[6] || /\bat\s*$/i.test(title.slice(0, timeMatch.index)))) {
    const toMinutes = (hourText: string, minuteText?: string, meridiem?: string) => {
      let hour = Number(hourText);
      if (meridiem?.toLocaleLowerCase() === "pm" && hour < 12) hour += 12;
      if (meridiem?.toLocaleLowerCase() === "am" && hour === 12) hour = 0;
      return hour * 60 + Number(minuteText || 0);
    };
    startMinutes = toMinutes(timeMatch[1], timeMatch[2], timeMatch[3] || timeMatch[6]);
    endMinutes = timeMatch[4]
      ? toMinutes(timeMatch[4], timeMatch[5], timeMatch[6] || timeMatch[3])
      : startMinutes + 60;
    if (endMinutes <= startMinutes) endMinutes += 12 * 60;
    title = title.replace(timeMatch[0], "");
  }

  const cleanTitle = title.replace(/\s{2,}/g, " ").replace(/^[,\s-]+|[,\s-]+$/g, "").trim();
  return {
    ...draft,
    title: cleanTitle || draft.title.trim(),
    date: toDayKey(date),
    endDate: toDayKey(date),
    ...(startMinutes !== null && endMinutes !== null
      ? { allDay: false, startTime: clockValue(startMinutes), endTime: clockValue(Math.min(endMinutes, 24 * 60 - 1)) }
      : {}),
  };
}

function makeSeriesId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `series-${crypto.randomUUID()}`
    : `series-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function daysBetween(start: Date, end: Date) {
  return Math.round((atNoon(end).getTime() - atNoon(start).getTime()) / 86_400_000);
}

function eventOccursOnDay(event: CalendarEvent, date: Date) {
  const key = toDayKey(date);
  return dayOf(event.start) <= key && dayOf(event.end) >= key;
}

function findConflicts(draft: EventDraft, events: CalendarEvent[]) {
  const candidate = eventPayload(draft);
  const start = new Date(candidate.start).getTime();
  const end = new Date(candidate.end).getTime();
  const attendeeEmails = new Set(candidate.attendees.map((attendee) => attendee.email));
  return events.filter((event) => {
    if (event.id === draft.id || new Date(event.start).getTime() >= end || new Date(event.end).getTime() <= start) return false;
    const sameCalendar = (event.calendarId ?? "default") === draft.calendarId;
    const sharedAttendee = (event.attendees ?? []).some((attendee) => attendeeEmails.has(attendee.email));
    return sameCalendar || sharedAttendee;
  });
}

function recurringPayloads(draft: EventDraft) {
  const payload = eventPayload(draft);
  if (draft.repeat === "none") return [payload];

  const seriesId = draft.seriesId ?? makeSeriesId();
  const baseStart = fromDayKey(draft.date);
  const baseEnd = fromDayKey(draft.endDate);
  const span = Math.max(0, daysBetween(baseStart, baseEnd));
  const until = fromDayKey(draft.repeatUntil);
  const results: Array<ReturnType<typeof eventPayload>> = [];
  const interval = Math.max(1, draft.repeatInterval);
  const dates: Date[] = [];

  if (draft.repeat === "weekly") {
    const weekZero = startOfWeek(baseStart);
    const weekdays = draft.repeatWeekdays.length ? draft.repeatWeekdays : [baseStart.getDay()];
    for (let cursor = baseStart; cursor <= until && dates.length < 500; cursor = addDays(cursor, 1)) {
      const weekIndex = Math.floor(daysBetween(weekZero, cursor) / 7);
      if (weekIndex % interval === 0 && weekdays.includes(cursor.getDay())) dates.push(cursor);
    }
  } else {
    for (let index = 0; dates.length < 500; index += 1) {
      const occurrence = draft.repeat === "daily"
        ? addDays(baseStart, index * interval)
        : addMonthsClamped(baseStart, index * interval);
      if (occurrence > until) break;
      dates.push(occurrence);
    }
  }

  dates.forEach((occurrence) => {
    const occurrenceEnd = addDays(occurrence, span);
    results.push({
      ...payload,
      start: `${toDayKey(occurrence)}T${draft.allDay ? "00:00" : draft.startTime}:00`,
      end: `${toDayKey(occurrenceEnd)}T${draft.allDay ? "23:59" : draft.endTime}:00`,
      seriesId,
      recurrence: {
        frequency: draft.repeat as RecurrenceFrequency,
        until: draft.repeatUntil,
        interval,
        weekdays: draft.repeat === "weekly" ? draft.repeatWeekdays : undefined,
      },
    });
  });

  return results;
}

function escapeIcs(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}

function icsTimestamp(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function exportCalendarIcs(events: CalendarEvent[]) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Workspace Calendar//EN", "CALSCALE:GREGORIAN"];
  events.forEach((event) => {
    lines.push("BEGIN:VEVENT", `UID:${event.id}@workspace-calendar`, `SUMMARY:${escapeIcs(event.title)}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${dayOf(event.start).replaceAll("-", "")}`);
      lines.push(`DTEND;VALUE=DATE:${toDayKey(addDays(fromDayKey(dayOf(event.end)), 1)).replaceAll("-", "")}`);
    } else {
      lines.push(`DTSTART:${icsTimestamp(event.start)}`, `DTEND:${icsTimestamp(event.end)}`);
    }
    if (event.location) lines.push(`LOCATION:${escapeIcs(event.location)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeIcs(event.notes)}`);
    (event.attendees ?? []).forEach((attendee) => lines.push(`ATTENDEE;PARTSTAT=${attendee.status.toUpperCase()}:mailto:${attendee.email}`));
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

function parseIcs(text: string): Array<Omit<CalendarEvent, "id" | "createdAt" | "createdBy">> {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];
  const read = (block: string, key: string) => block.match(new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, "mi"))?.[1]?.trim() ?? "";
  const parseDate = (value: string, end = false) => {
    if (/^\d{8}$/.test(value)) {
      const key = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
      return `${key}T${end ? "23:59" : "00:00"}:00`;
    }
    const parsed = new Date(value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/, "$1-$2-$3T$4:$5:$6Z"));
    return Number.isNaN(parsed.getTime()) ? "" : toLocalIso(parsed);
  };
  return blocks.flatMap((block) => {
    const rawStart = read(block, "DTSTART");
    const rawEnd = read(block, "DTEND");
    const allDay = /^\d{8}$/.test(rawStart);
    let start = parseDate(rawStart);
    let end = parseDate(rawEnd, allDay);
    if (!start) return [];
    if (!end) end = allDay ? `${dayOf(start)}T23:59:00` : toLocalIso(new Date(new Date(start).getTime() + 3_600_000));
    if (allDay && /^\d{8}$/.test(rawEnd)) end = `${toDayKey(addDays(fromDayKey(dayOf(end)), -1))}T23:59:00`;
    const unescape = (value: string) => value.replaceAll("\\n", "\n").replaceAll("\\,", ",").replaceAll("\\;", ";").replaceAll("\\\\", "\\");
    return [{
      title: unescape(read(block, "SUMMARY")) || "Imported event",
      start,
      end,
      allDay,
      tone: "accent" as EventTone,
      location: unescape(read(block, "LOCATION")),
      notes: unescape(read(block, "DESCRIPTION")),
      reminderMinutes: 10,
      calendarId: "default",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      attendees: [],
    }];
  });
}

function monthCells(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1, 12);
  const start = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function isSameDay(a: Date, b: Date) {
  return toDayKey(a) === toDayKey(b);
}

function viewStart(anchor: Date, view: ViewMode) {
  if (view === "month") return startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12));
  if (view === "agenda") return atNoon(anchor);
  if (view === "week" || view === "twelve") return startOfWeek(anchor);
  return atNoon(anchor);
}

function viewEnd(anchor: Date, view: ViewMode) {
  if (view === "month") return addDays(viewStart(anchor, view), 41);
  if (view === "agenda") return addDays(viewStart(anchor, view), 29);
  return addDays(viewStart(anchor, view), VIEW_LENGTH[view] - 1);
}

export function CalendarPanel() {
  const calendar = useCalendar();
  const viewer = useCurrentUser();
  const [view, setView] = useGlobalPersistedState<ViewMode>("calendar/view", "week", { scope: "user" });
  const [anchorKey, setAnchorKey] = useGlobalPersistedState("calendar/anchor", toDayKey(new Date()), {
    scope: "user",
  });
  const [sidebarOpen, setSidebarOpen] = useGlobalPersistedState("calendar/sidebar", true, { scope: "user" });
  const [query, setQuery] = useGlobalPersistedState("calendar/search", "", { scope: "user" });
  const [hiddenCalendarIds, setHiddenCalendarIds] = useGlobalPersistedState<string[]>("calendar/hidden-calendars", [], { scope: "user" });
  const [searchOpen, setSearchOpen] = useState(false);
  const [calendarCreatorOpen, setCalendarCreatorOpen] = useState(false);
  const [newCalendarName, setNewCalendarName] = useState("");
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const context = useContextMenu();
  const calendarActionsContext = useContextMenu();
  const importInputRef = useRef<HTMLInputElement>(null);
  const reminderCache = useRef(new Set<string>());
  const snoozedUntil = useRef(new Map<string, number>());
  const anchor = fromDayKey(anchorKey);

  const visibleEvents = useMemo(
    () => calendar.events.filter((event) => !hiddenCalendarIds.includes(event.calendarId ?? "default")),
    [calendar.events, hiddenCalendarIds]
  );

  const filteredEvents = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return visibleEvents;
    return visibleEvents.filter((event) =>
      [event.title, event.location, event.notes, event.createdBy].some((value) =>
        value.toLocaleLowerCase().includes(needle)
      )
    );
  }, [query, visibleEvents]);

  const rangeStart = viewStart(anchor, view);
  const rangeEnd = viewEnd(anchor, view);

  const openCreate = useCallback((date = anchor, hour?: number, allDay = false) => {
    setDraft({ ...defaultDraft(date, hour), allDay });
  }, [anchor]);

  const openCreateRange = useCallback((date: Date, startMinutes: number, endMinutes: number) => {
    setDraft(rangeDraft(date, startMinutes, endMinutes));
  }, []);

  const openCreateDateRange = useCallback((start: Date, end: Date) => {
    setDraft(dateRangeDraft(start, end));
  }, []);

  const openEdit = useCallback((event: CalendarEvent) => setDraft(draftFromEvent(event)), []);

  const downloadIcs = useCallback(() => {
    const blob = new Blob([exportCalendarIcs(visibleEvents)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "workspace-calendar.ics";
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Calendar exported");
  }, [visibleEvents]);

  const moveEvent = useCallback(
    (event: CalendarEvent, date: Date, hour?: number) => {
      const oldStart = new Date(event.start);
      const oldEnd = new Date(event.end);
      const duration = Math.max(30 * 60_000, oldEnd.getTime() - oldStart.getTime());
      const allDaySpan = Math.max(0, daysBetween(fromDayKey(dayOf(event.start)), fromDayKey(dayOf(event.end))));
      const nextStart = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        hour ?? oldStart.getHours(),
        hour === undefined ? oldStart.getMinutes() : 0
      );
      const nextEnd = new Date(nextStart.getTime() + duration);
      const nextAllDayEnd = addDays(date, allDaySpan);
      calendar.updateEvent(event.id, {
        start: event.allDay ? `${toDayKey(date)}T00:00:00` : toLocalIso(nextStart),
        end: event.allDay ? `${toDayKey(nextAllDayEnd)}T23:59:00` : toLocalIso(nextEnd),
      });
      toast("Event rescheduled", {
        description: `${event.title} · ${toDayKey(date)}`,
        action: {
          label: "Undo",
          onClick: () => calendar.updateEvent(event.id, { start: event.start, end: event.end }),
        },
      });
    },
    [calendar]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        openCreate(new Date());
      } else if (event.key.toLowerCase() === "t") {
        setAnchorKey(toDayKey(new Date()));
      } else if (event.key === "ArrowLeft") {
        setAnchorKey(toDayKey(addDays(anchor, -1)));
      } else if (event.key === "ArrowRight") {
        setAnchorKey(toDayKey(addDays(anchor, 1)));
      } else if (event.key === "Escape") {
        setDraft(null);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [anchor, openCreate, setAnchorKey]);

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      calendar.events.forEach((event) => {
        if (event.allDay || event.reminderMinutes < 0) return;
        const snoozed = snoozedUntil.current.get(event.id);
        if (snoozed && snoozed > now) return;
        if (snoozed && snoozed <= now) {
          snoozedUntil.current.delete(event.id);
          reminderCache.current.delete(event.id);
        }
        const reminderAt = new Date(event.start).getTime() - event.reminderMinutes * 60_000;
        if (reminderAt <= now && now - reminderAt < 60_000 && !reminderCache.current.has(event.id)) {
          reminderCache.current.add(event.id);
          toast(event.title, {
            description: event.reminderMinutes === 0 ? "Starting now" : `Starts in ${event.reminderMinutes} minutes`,
            duration: Infinity,
            action: {
              label: "Snooze 5m",
              onClick: () => {
                snoozedUntil.current.set(event.id, Date.now() + 5 * 60_000);
                reminderCache.current.delete(event.id);
              },
            },
          });
        }
      });
    };
    check();
    const timer = window.setInterval(check, 30_000);
    return () => window.clearInterval(timer);
  }, [calendar.events]);

  const navigate = (direction: -1 | 1) => {
    if (view === "month") setAnchorKey(toDayKey(addMonths(anchor, direction)));
    else if (view === "agenda") setAnchorKey(toDayKey(addDays(anchor, 30 * direction)));
    else setAnchorKey(toDayKey(addDays(anchor, VIEW_LENGTH[view] * direction)));
  };

  const menuEvent = context.state.data as CalendarEvent | undefined;

  if (!calendar.ready && !calendar.failed) {
    return (
      <StateView>
        <Spinner />
        <StateTitle>Opening calendar…</StateTitle>
        <StateText>Connecting to the workspace schedule.</StateText>
      </StateView>
    );
  }

  if (calendar.failed) {
    return (
      <StateView>
        <Icon name="Calendar" size={28} />
        <StateTitle>Calendar unavailable</StateTitle>
        <StateText>The collaborative document could not be opened. Try reopening this panel.</StateText>
      </StateView>
    );
  }

  return (
    <Root>
      <TopBar>
        <ToolbarGroup>
          <SidebarToggle title={sidebarOpen ? "Hide sidebar" : "Show sidebar"} onClick={() => setSidebarOpen(!sidebarOpen)}>
            <Icon name="PanelLeft" size={15} />
          </SidebarToggle>
          <CalendarTitle>
            {anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </CalendarTitle>
        </ToolbarGroup>
        <ToolbarGroup>
          {searchOpen ? (
            <SearchBox>
              <Icon name="Search" size={14} />
              <SearchInput
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search events"
              />
              <BareButton title="Close search" onClick={() => setSearchOpen(false)}>
                <Icon name="X" size={13} />
              </BareButton>
            </SearchBox>
          ) : (
            <IconButton title="Search events" onClick={() => setSearchOpen(true)}>
              <Icon name="Search" size={15} />
            </IconButton>
          )}
          <ViewSelect value={view} onChange={(event) => setView(event.target.value as ViewMode)}>
            <option value="day">Day</option>
            <option value="three">3 days</option>
            <option value="week">Week</option>
            <option value="twelve">12 days</option>
            <option value="month">Month</option>
            <option value="agenda">Agenda</option>
          </ViewSelect>
          <TodayButton $variant="secondary" $compact onClick={() => setAnchorKey(toDayKey(new Date()))}>
            Today
          </TodayButton>
          <RangeNavigationButton title="Previous" onClick={() => navigate(-1)}>
            <Icon name="ChevronLeft" size={15} />
          </RangeNavigationButton>
          <RangeNavigationButton title="Next" onClick={() => navigate(1)}>
            <Icon name="ChevronRight" size={15} />
          </RangeNavigationButton>
          <CreateButton title="New event (C)" onClick={() => openCreate(new Date())}>
            <Icon name="Plus" size={15} />
          </CreateButton>
        </ToolbarGroup>
      </TopBar>

      <HiddenFileInput
        ref={importInputRef}
        type="file"
        accept=".ics,text/calendar"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const imported = parseIcs(await file.text());
          calendar.addEvents(imported);
          toast.success("Calendar imported", { description: `${imported.length} events` });
          event.target.value = "";
        }}
      />

      <Workspace>
          <Sidebar $open={sidebarOpen} aria-hidden={!sidebarOpen}>
            <MiniCalendar
              anchor={anchor}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              onSelect={(date) => setAnchorKey(toDayKey(date))}
              onNavigate={(amount) => setAnchorKey(toDayKey(addMonths(anchor, amount)))}
            />
            <CalendarListSection>
              <SidebarHeading>
                <span>Calendars</span>
                <BareButton title="Calendar actions" onClick={(event) => calendarActionsContext.handleContextMenu(event)}>
                  <Icon name="Plus" size={13} />
                </BareButton>
              </SidebarHeading>
              {calendar.calendars.map((item) => (
                <CalendarListRow key={item.id}>
                  <ToneDot $tone={item.tone} />
                  <CalendarListName
                    title="Double-click to rename"
                    onDoubleClick={() => {
                      const name = window.prompt("Calendar name", item.name)?.trim();
                      if (name) calendar.updateCalendar(item.id, { name });
                    }}
                  >
                    {item.name}
                  </CalendarListName>
                  {item.id !== "default" && (
                    <CalendarRemoveButton title="Delete calendar" onClick={() => calendar.deleteCalendar(item.id)}>
                      <Icon name="X" size={11} />
                    </CalendarRemoveButton>
                  )}
                  <Toggle
                    checked={!hiddenCalendarIds.includes(item.id)}
                    onChange={(visible) => setHiddenCalendarIds(
                      visible
                        ? hiddenCalendarIds.filter((id) => id !== item.id)
                        : [...hiddenCalendarIds, item.id]
                    )}
                  />
                </CalendarListRow>
              ))}
              {calendarCreatorOpen && (
                <CalendarCreatorRow>
                  <Input
                    autoFocus
                    value={newCalendarName}
                    placeholder="Calendar name"
                    onChange={(event) => setNewCalendarName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") { setCalendarCreatorOpen(false); setNewCalendarName(""); }
                      if (event.key === "Enter" && newCalendarName.trim()) {
                        calendar.addCalendar(newCalendarName);
                        setCalendarCreatorOpen(false);
                        setNewCalendarName("");
                      }
                    }}
                  />
                </CalendarCreatorRow>
              )}
            </CalendarListSection>
            <SidebarSection>
              <SidebarHeading>
                <span>Upcoming</span>
                <Count>{visibleEvents.filter((event) => new Date(event.end).getTime() >= Date.now()).length}</Count>
              </SidebarHeading>
              <UpcomingList>
                {visibleEvents.filter((event) => new Date(event.end).getTime() >= Date.now()).slice(0, 8).map((event) => (
                  <UpcomingRow key={event.id} onClick={() => openEdit(event)}>
                    <ToneDot $tone={event.tone} />
                    <UpcomingContent>
                      <UpcomingTitle>{event.title}</UpcomingTitle>
                      <UpcomingMeta>
                        {new Date(event.start).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        {!event.allDay && ` · ${formatTime(event.start, event.timezone)}`}
                      </UpcomingMeta>
                    </UpcomingContent>
                  </UpcomingRow>
                ))}
                {!visibleEvents.some((event) => new Date(event.end).getTime() >= Date.now()) && (
                  <SidebarEmpty>No upcoming events</SidebarEmpty>
                )}
              </UpcomingList>
            </SidebarSection>
            <SidebarFooter>
              <UserAvatar name={viewer?.name || "Workspace member"} avatarUrl={viewer?.avatarUrl} size={22} />
              <CalendarIdentity>
                <IdentityName>Workspace calendar</IdentityName>
                <IdentityMeta>Shared with everyone here</IdentityMeta>
              </CalendarIdentity>
              <ToneDot $tone="accent" />
            </SidebarFooter>
          </Sidebar>

        <CalendarCanvas>
          {query && (
            <FilterBanner>
              Showing {filteredEvents.length} result{filteredEvents.length === 1 ? "" : "s"} for “{query}”
              <BareTextButton onClick={() => setQuery("")}>Clear</BareTextButton>
            </FilterBanner>
          )}
          <StandardCalendarView>
            {view === "month" ? (
              <MonthView
                anchor={anchor}
                events={filteredEvents}
                onSelect={(date) => setAnchorKey(toDayKey(date))}
                onCreate={openCreate}
                onCreateRange={openCreateDateRange}
                onEdit={openEdit}
                onMove={moveEvent}
                onContextMenu={context.handleContextMenu}
              />
            ) : view === "agenda" ? (
              <AgendaView
                anchor={anchor}
                events={filteredEvents}
                onSelect={(date) => setAnchorKey(toDayKey(date))}
                onEdit={openEdit}
                onCreate={openCreate}
              />
            ) : (
              <ScheduleView
                anchor={anchor}
                view={view}
                events={filteredEvents}
                onCreate={openCreate}
                onCreateRange={openCreateRange}
                onEdit={openEdit}
                onMove={moveEvent}
                onContextMenu={context.handleContextMenu}
              />
            )}
          </StandardCalendarView>
          <CompactMonthView
            anchor={anchor}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            events={filteredEvents}
            onSelect={(date) => setAnchorKey(toDayKey(date))}
            onNavigate={(amount) => setAnchorKey(toDayKey(addMonths(anchor, amount)))}
            onCreate={openCreate}
            onEdit={openEdit}
          />
        </CalendarCanvas>
      </Workspace>

      {draft && (
        <EventEditor
          draft={draft}
          calendars={calendar.calendars}
          conflicts={findConflicts(draft, calendar.events)}
          onChange={setDraft}
          onClose={() => setDraft(null)}
          onSave={(submitted) => {
            const next = parseNaturalLanguageDraft(submitted);
            if (!next.title.trim()) {
              toast.error("Event needs a title");
              return;
            }
            const payload = eventPayload(next);
            if (fromDayKey(next.endDate) < fromDayKey(next.date)) {
              toast.error("End date must be on or after start date");
              return;
            }
            if (!next.allDay && new Date(payload.end) <= new Date(payload.start)) {
              toast.error("End time must be after start time");
              return;
            }
            if (next.repeat !== "none" && fromDayKey(next.repeatUntil) < fromDayKey(next.date)) {
              toast.error("Repeat end must be on or after the first event");
              return;
            }

            if (next.id && next.seriesId && next.editScope !== "occurrence") {
              const current = calendar.events.find((event) => event.id === next.id);
              const seriesEvents = calendar.events
                .filter((event) => event.seriesId === next.seriesId)
                .sort((a, b) => a.start.localeCompare(b.start));
              const span = Math.max(0, daysBetween(fromDayKey(next.date), fromDayKey(next.endDate)));
              const firstDate = next.editScope === "series" && seriesEvents[0]
                ? fromDayKey(dayOf(seriesEvents[0].start))
                : fromDayKey(next.date);
              const replacement = {
                ...next,
                id: undefined,
                date: toDayKey(firstDate),
                endDate: toDayKey(addDays(firstDate, span)),
                seriesId: next.repeat === "none" ? undefined : next.seriesId,
              };
              calendar.deleteSeries(next.seriesId, next.editScope === "future" ? current?.start : undefined);
              calendar.addEvents(recurringPayloads(replacement));
              toast.success(next.editScope === "future" ? "This and future events updated" : "Recurring series updated");
            } else if (next.id && next.seriesId) {
              calendar.updateEvent(next.id, payload);
              toast.success("Occurrence updated");
            } else if (next.id && next.repeat !== "none") {
              const occurrences = recurringPayloads(next);
              calendar.updateEvent(next.id, occurrences[0]);
              calendar.addEvents(occurrences.slice(1));
              toast.success(`Recurring event created`, { description: `${occurrences.length} occurrences` });
            } else if (next.id) {
              calendar.updateEvent(next.id, payload);
              toast.success("Event updated");
            } else if (next.repeat !== "none") {
              const occurrences = recurringPayloads(next);
              calendar.addEvents(occurrences);
              toast.success(`Recurring event created`, { description: `${occurrences.length} occurrences` });
            } else {
              calendar.addEvent(payload);
              toast.success("Event created");
            }
            setDraft(null);
          }}
          onDelete={
            draft.id
              ? () => {
                  const deleted = calendar.events.find((event) => event.id === draft.id);
                  calendar.deleteEvent(draft.id!);
                  toast("Event deleted", deleted ? {
                    action: { label: "Undo", onClick: () => calendar.addEvent(storedEventPayload(deleted)) },
                  } : undefined);
                  setDraft(null);
                }
              : undefined
          }
          onDeleteSeries={
            draft.seriesId
              ? () => {
                  const deleted = calendar.events.filter((event) => event.seriesId === draft.seriesId);
                  calendar.deleteSeries(draft.seriesId!);
                  toast("Recurring series deleted", {
                    action: {
                      label: "Undo",
                      onClick: () => calendar.addEvents(deleted.map(storedEventPayload)),
                    },
                  });
                  setDraft(null);
                }
              : undefined
          }
        />
      )}

      {calendarActionsContext.state.isOpen && (
        <ContextMenu x={calendarActionsContext.state.x} y={calendarActionsContext.state.y}>
          <ContextMenuItem onClick={() => { setCalendarCreatorOpen(true); calendarActionsContext.close(); }}>New calendar</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => { importInputRef.current?.click(); calendarActionsContext.close(); }}>Import ICS</ContextMenuItem>
          <ContextMenuItem onClick={() => { downloadIcs(); calendarActionsContext.close(); }}>Export ICS</ContextMenuItem>
        </ContextMenu>
      )}

      {context.state.isOpen && menuEvent && (
        <ContextMenu x={context.state.x} y={context.state.y}>
          <ContextMenuItem onClick={() => { openEdit(menuEvent); context.close(); }}>
            Edit event
          </ContextMenuItem>
          <ContextMenuItem onClick={() => { calendar.duplicateEvent(menuEvent.id); context.close(); toast.success("Event duplicated"); }}>
            Duplicate
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="danger" onClick={() => {
            calendar.deleteEvent(menuEvent.id);
            context.close();
            toast("Event deleted", { action: { label: "Undo", onClick: () => calendar.addEvent(storedEventPayload(menuEvent)) } });
          }}>
            {menuEvent.seriesId ? "Delete occurrence" : "Delete"}
          </ContextMenuItem>
          {menuEvent.seriesId && (
            <ContextMenuItem variant="danger" onClick={() => {
              const deleted = calendar.events.filter((event) => event.seriesId === menuEvent.seriesId);
              calendar.deleteSeries(menuEvent.seriesId!);
              context.close();
              toast("Recurring series deleted", { action: { label: "Undo", onClick: () => calendar.addEvents(deleted.map(storedEventPayload)) } });
            }}>
              Delete series
            </ContextMenuItem>
          )}
        </ContextMenu>
      )}
    </Root>
  );
}

function toLocalIso(date: Date) {
  return `${toDayKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:00`;
}

function MiniCalendar({
  anchor,
  rangeStart,
  rangeEnd,
  onSelect,
  onNavigate,
}: {
  anchor: Date;
  rangeStart: Date;
  rangeEnd: Date;
  onSelect: (date: Date) => void;
  onNavigate: (amount: number) => void;
}) {
  const cells = monthCells(anchor);
  const today = new Date();
  return (
    <MiniWrap>
      <MiniHeader>
        <MiniTitle>{anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</MiniTitle>
        <MiniNavGroup>
          <MiniNav title="Previous month" onClick={() => onNavigate(-1)}><Icon name="ChevronLeft" size={13} /></MiniNav>
          <MiniNav title="Next month" onClick={() => onNavigate(1)}><Icon name="ChevronRight" size={13} /></MiniNav>
        </MiniNavGroup>
      </MiniHeader>
      <MiniGrid>
        {WEEKDAYS.map((day) => <MiniWeekday key={day}>{day.slice(0, 1)}</MiniWeekday>)}
        {cells.map((date) => (
          <MiniDay
            key={toDayKey(date)}
            $outside={date.getMonth() !== anchor.getMonth()}
            $inRange={date >= rangeStart && date <= rangeEnd}
            $today={isSameDay(date, today)}
            $selected={isSameDay(date, anchor)}
            onClick={() => onSelect(date)}
          >
            {date.getDate()}
          </MiniDay>
        ))}
      </MiniGrid>
    </MiniWrap>
  );
}

function CompactMonthView({
  anchor,
  rangeStart,
  rangeEnd,
  events,
  onSelect,
  onNavigate,
  onCreate,
  onEdit,
}: {
  anchor: Date;
  rangeStart: Date;
  rangeEnd: Date;
  events: CalendarEvent[];
  onSelect: (date: Date) => void;
  onNavigate: (amount: number) => void;
  onCreate: (date: Date, hour?: number, allDay?: boolean) => void;
  onEdit: (event: CalendarEvent) => void;
}) {
  const selectedEvents = events.filter((event) => eventOccursOnDay(event, anchor));
  return (
    <CompactMonthShell>
      <MiniCalendar
        anchor={anchor}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        onSelect={onSelect}
        onNavigate={onNavigate}
      />
      <CompactAgenda>
        <CompactAgendaHeader>
          <CompactAgendaTitle>
            {anchor.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </CompactAgendaTitle>
          <IconButton title="Add event" onClick={() => onCreate(anchor)}>
            <Icon name="Plus" size={14} />
          </IconButton>
        </CompactAgendaHeader>
        {selectedEvents.length ? (
          selectedEvents.map((event) => (
            <CompactEventRow key={event.id} onClick={() => onEdit(event)}>
              <ToneDot $tone={event.tone} />
              <UpcomingContent>
                <UpcomingTitle>{event.title}</UpcomingTitle>
                <UpcomingMeta>{event.allDay ? "All day" : `${formatTime(event.start, event.timezone)} – ${formatTime(event.end, event.timezone)}`}</UpcomingMeta>
              </UpcomingContent>
            </CompactEventRow>
          ))
        ) : (
          <CompactEmpty>No events on this day</CompactEmpty>
        )}
      </CompactAgenda>
    </CompactMonthShell>
  );
}

function MonthView({
  anchor,
  events,
  onSelect,
  onCreate,
  onCreateRange,
  onEdit,
  onMove,
  onContextMenu,
}: {
  anchor: Date;
  events: CalendarEvent[];
  onSelect: (date: Date) => void;
  onCreate: (date: Date, hour?: number, allDay?: boolean) => void;
  onCreateRange: (start: Date, end: Date) => void;
  onEdit: (event: CalendarEvent) => void;
  onMove: (event: CalendarEvent, date: Date, hour?: number) => void;
  onContextMenu: (event: MouseEvent, data?: unknown) => void;
}) {
  const today = new Date();
  const cells = monthCells(anchor);
  const rangeRef = useRef<{
    startKey: string;
    currentKey: string;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [rangeSelection, setRangeSelection] = useState<{ startKey: string; currentKey: string } | null>(null);

  const startRange = (event: ReactPointerEvent<HTMLDivElement>, date: Date) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-calendar-event]")) return;
    const key = toDayKey(date);
    rangeRef.current = {
      startKey: key,
      currentKey: key,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveRange = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = rangeRef.current;
    if (!active) return;
    const moved = active.moved || Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >= 6;
    if (!moved) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-day-key]");
    const currentKey = target?.dataset.dayKey;
    if (!currentKey) return;
    event.preventDefault();
    rangeRef.current = { ...active, currentKey, moved: true };
    setRangeSelection({ startKey: active.startKey, currentKey });
  };

  const finishRange = (event: ReactPointerEvent<HTMLDivElement>, date: Date) => {
    const active = rangeRef.current;
    if (!active) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    rangeRef.current = null;
    setRangeSelection(null);
    if (active.moved) onCreateRange(fromDayKey(active.startKey), fromDayKey(active.currentKey));
    else onSelect(date);
  };

  const selectionStart = rangeSelection && [rangeSelection.startKey, rangeSelection.currentKey].sort()[0];
  const selectionEnd = rangeSelection && [rangeSelection.startKey, rangeSelection.currentKey].sort()[1];

  return (
    <MonthShell>
      <MonthWeekdays>{WEEKDAYS.map((day) => <MonthWeekday role="columnheader" key={day}>{day}</MonthWeekday>)}</MonthWeekdays>
      <MonthGrid role="grid">
        {cells.map((date) => {
          const key = toDayKey(date);
          const dayEvents = events.filter((event) => eventOccursOnDay(event, date));
          return (
            <MonthCell
              key={key}
              $outside={date.getMonth() !== anchor.getMonth()}
              $selected={isSameDay(date, anchor)}
              $inSelection={Boolean(selectionStart && selectionEnd && key >= selectionStart && key <= selectionEnd)}
              data-day-key={key}
              role="gridcell"
              tabIndex={0}
              aria-selected={isSameDay(date, anchor)}
              title="Select date; double-click or drag to add an event"
              onPointerDown={(event) => startRange(event, date)}
              onPointerMove={moveRange}
              onPointerUp={(event) => finishRange(event, date)}
              onPointerCancel={() => { rangeRef.current = null; setRangeSelection(null); }}
              onDoubleClick={() => onCreate(date, undefined, true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSelect(date);
                if (event.key === " ") { event.preventDefault(); onCreate(date, undefined, true); }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const item = events.find((candidate) => candidate.id === event.dataTransfer.getData("calendar/event"));
                if (item) onMove(item, date);
              }}
            >
              <MonthDayNumber $today={isSameDay(date, today)}>{date.getDate()}</MonthDayNumber>
              <MonthEvents>
                {dayEvents.slice(0, 4).map((event) => (
                  <MonthEvent
                    key={event.id}
                    $tone={event.tone}
                    $continuesBefore={dayOf(event.start) < key}
                    $continuesAfter={dayOf(event.end) > key}
                    draggable
                    onDragStart={(drag) => drag.dataTransfer.setData("calendar/event", event.id)}
                    onClick={(click) => { click.stopPropagation(); onEdit(event); }}
                    onDoubleClick={(click) => click.stopPropagation()}
                    onContextMenu={(click) => onContextMenu(click, event)}
                    data-calendar-event
                    title={event.title}
                  >
                    {!event.allDay && dayOf(event.start) === key && <MonthEventTime>{formatTime(event.start, event.timezone)}</MonthEventTime>}
                    <EventTitle>{dayOf(event.start) === key || date.getDay() === 1 ? event.title : ""}</EventTitle>
                  </MonthEvent>
                ))}
                {dayEvents.length > 4 && <MoreEvents>+{dayEvents.length - 4} more</MoreEvents>}
              </MonthEvents>
            </MonthCell>
          );
        })}
      </MonthGrid>
    </MonthShell>
  );
}

function AgendaView({
  anchor,
  events,
  onSelect,
  onEdit,
  onCreate,
}: {
  anchor: Date;
  events: CalendarEvent[];
  onSelect: (date: Date) => void;
  onEdit: (event: CalendarEvent) => void;
  onCreate: (date: Date, hour?: number, allDay?: boolean) => void;
}) {
  const days = Array.from({ length: 30 }, (_, index) => addDays(anchor, index));
  const populated = days
    .map((date) => ({ date, events: events.filter((event) => eventOccursOnDay(event, date)) }))
    .filter((group) => group.events.length);

  return (
    <AgendaShell>
      {populated.length ? populated.map((group) => (
        <AgendaDay key={toDayKey(group.date)}>
          <AgendaDateButton onClick={() => onSelect(group.date)}>
            <AgendaWeekday>{group.date.toLocaleDateString(undefined, { weekday: "short" })}</AgendaWeekday>
            <AgendaNumber>{group.date.getDate()}</AgendaNumber>
          </AgendaDateButton>
          <AgendaEvents>
            {group.events.map((event) => (
              <AgendaEvent key={event.id} onClick={() => onEdit(event)}>
                <ToneDot $tone={event.tone} />
                <UpcomingContent>
                  <UpcomingTitle>{event.title}</UpcomingTitle>
                  <UpcomingMeta>
                    {event.allDay ? "All day" : `${formatTime(event.start, event.timezone)} – ${formatTime(event.end, event.timezone)}`}
                    {event.location ? ` · ${event.location}` : ""}
                  </UpcomingMeta>
                </UpcomingContent>
              </AgendaEvent>
            ))}
          </AgendaEvents>
        </AgendaDay>
      )) : (
        <AgendaEmpty>
          <StateTitle>No upcoming events</StateTitle>
          <StateText>The next 30 days are clear.</StateText>
          <Button $variant="primary" $compact onClick={() => onCreate(anchor)}>Add event</Button>
        </AgendaEmpty>
      )}
    </AgendaShell>
  );
}

function ScheduleView({
  anchor,
  view,
  events,
  onCreate,
  onCreateRange,
  onEdit,
  onMove,
  onContextMenu,
}: {
  anchor: Date;
  view: Exclude<ViewMode, "month">;
  events: CalendarEvent[];
  onCreate: (date: Date, hour?: number, allDay?: boolean) => void;
  onCreateRange: (date: Date, startMinutes: number, endMinutes: number) => void;
  onEdit: (event: CalendarEvent) => void;
  onMove: (event: CalendarEvent, date: Date, hour?: number) => void;
  onContextMenu: (event: MouseEvent, data?: unknown) => void;
}) {
  const start = viewStart(anchor, view);
  const days = Array.from({ length: VIEW_LENGTH[view] }, (_, index) => addDays(start, index));
  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, index) => START_HOUR + index);
  const today = new Date();
  const now = new Date();
  const dragSelection = useRef<{ dayKey: string; anchorSlot: number; currentSlot: number } | null>(null);
  const [selection, setSelection] = useState<{ dayKey: string; anchorSlot: number; currentSlot: number } | null>(null);

  const slotAtPointer = (event: ReactPointerEvent, element: HTMLElement) => {
    const relativeY = event.clientY - element.getBoundingClientRect().top;
    return Math.max(0, Math.min(hours.length * 2 - 1, Math.floor(relativeY / (HOUR_HEIGHT / 2))));
  };

  const startSelection = (event: ReactPointerEvent<HTMLDivElement>, date: Date) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("[data-calendar-event]")) return;
    event.preventDefault();
    const slot = slotAtPointer(event, event.currentTarget);
    const next = { dayKey: toDayKey(date), anchorSlot: slot, currentSlot: slot };
    dragSelection.current = next;
    setSelection(next);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragSelection.current;
    if (!active) return;
    const next = { ...active, currentSlot: slotAtPointer(event, event.currentTarget) };
    dragSelection.current = next;
    setSelection(next);
  };

  const finishSelection = (event: ReactPointerEvent<HTMLDivElement>, date: Date) => {
    const active = dragSelection.current;
    if (!active) return;
    const lastSlot = slotAtPointer(event, event.currentTarget);
    const first = Math.min(active.anchorSlot, lastSlot);
    const last = Math.max(active.anchorSlot, lastSlot);
    dragSelection.current = null;
    setSelection(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    onCreateRange(date, START_HOUR * 60 + first * 30, START_HOUR * 60 + (last + 1) * 30);
  };

  return (
    <ScheduleScroller>
      <ScheduleInner $days={days.length}>
        <ScheduleHeader>
          <Timezone>Local</Timezone>
          <DayHeaders $days={days.length}>
            {days.map((date) => (
              <DayHeader key={toDayKey(date)} $today={isSameDay(date, today)}>
                <DayName>{date.toLocaleDateString(undefined, { weekday: "short" })}</DayName>
                <DayNumber $today={isSameDay(date, today)}>{date.getDate()}</DayNumber>
              </DayHeader>
            ))}
          </DayHeaders>
        </ScheduleHeader>
        <AllDayRow>
          <AllDayLabel>All-day</AllDayLabel>
          <AllDayColumns $days={days.length}>
            {days.map((date) => (
              <AllDayCell
                key={toDayKey(date)}
                role="button"
                tabIndex={0}
                aria-label={`Add all-day event on ${date.toLocaleDateString()}`}
                onDoubleClick={() => onCreate(date, undefined, true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onCreate(date, undefined, true); }
                }}
              >
                {events.filter((event) => event.allDay && eventOccursOnDay(event, date)).map((event) => (
                  <AllDayEvent
                    key={event.id}
                    $tone={event.tone}
                    draggable
                    onDragStart={(drag) => drag.dataTransfer.setData("calendar/event", event.id)}
                    onClick={() => onEdit(event)}
                    onContextMenu={(click) => onContextMenu(click, event)}
                  >
                    <EventTitle>{event.title}</EventTitle>
                  </AllDayEvent>
                ))}
              </AllDayCell>
            ))}
          </AllDayColumns>
        </AllDayRow>
        <ScheduleBody>
          <TimeRail>
            {hours.map((hour) => <TimeLabel key={hour}>{formatHour(hour)}</TimeLabel>)}
          </TimeRail>
          <DayColumns $days={days.length}>
            {days.map((date) => {
              const dayEvents = events.filter((event) => !event.allDay && dayOf(event.start) === toDayKey(date));
              const nowTop = ((now.getHours() + now.getMinutes() / 60) - START_HOUR) * HOUR_HEIGHT;
              return (
                <DayColumn
                  key={toDayKey(date)}
                  title="Drag to select a time range"
                  onPointerDown={(event) => startSelection(event, date)}
                  onPointerMove={moveSelection}
                  onPointerUp={(event) => finishSelection(event, date)}
                  onPointerCancel={() => { dragSelection.current = null; setSelection(null); }}
                >
                  {hours.map((hour) => (
                    <TimeCell
                      key={hour}
                      role="button"
                      tabIndex={0}
                      aria-label={`Add event on ${date.toLocaleDateString()} at ${formatHour(hour)}`}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onCreate(date, hour); }
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const item = events.find((candidate) => candidate.id === event.dataTransfer.getData("calendar/event"));
                        if (item) onMove(item, date, hour);
                      }}
                    />
                  ))}
                  {isSameDay(date, today) && nowTop >= 0 && nowTop <= hours.length * HOUR_HEIGHT && (
                    <NowLine style={{ top: nowTop }}><NowDot /></NowLine>
                  )}
                  {selection?.dayKey === toDayKey(date) && (() => {
                    const first = Math.min(selection.anchorSlot, selection.currentSlot);
                    const last = Math.max(selection.anchorSlot, selection.currentSlot);
                    const startMinutes = START_HOUR * 60 + first * 30;
                    const endMinutes = START_HOUR * 60 + (last + 1) * 30;
                    return (
                      <TimeSelection
                        style={{ top: first * (HOUR_HEIGHT / 2), height: (last - first + 1) * (HOUR_HEIGHT / 2) }}
                      >
                        <EventTitle>New event</EventTitle>
                        <EventMeta>{formatMinutesOfDay(startMinutes)} – {formatMinutesOfDay(endMinutes)}</EventMeta>
                      </TimeSelection>
                    );
                  })()}
                  {dayEvents.map((event) => {
                    const startTime = new Date(event.start);
                    const endTime = new Date(event.end);
                    const startDecimal = startTime.getHours() + startTime.getMinutes() / 60;
                    const duration = Math.max(0.5, (endTime.getTime() - startTime.getTime()) / 3_600_000);
                    const top = Math.max(0, (startDecimal - START_HOUR) * HOUR_HEIGHT);
                    const height = Math.max(24, Math.min(duration * HOUR_HEIGHT, hours.length * HOUR_HEIGHT - top));
                    return (
                      <TimedEvent
                        key={event.id}
                        $tone={event.tone}
                        style={{ top, height }}
                        draggable
                        onDragStart={(drag) => drag.dataTransfer.setData("calendar/event", event.id)}
                        onClick={() => onEdit(event)}
                        onContextMenu={(click) => onContextMenu(click, event)}
                        data-calendar-event
                      >
                        <EventTitle>{event.title}</EventTitle>
                        <EventMeta>{formatTime(event.start, event.timezone)} – {formatTime(event.end, event.timezone)}</EventMeta>
                        {event.location && <EventMeta>{event.location}</EventMeta>}
                      </TimedEvent>
                    );
                  })}
                </DayColumn>
              );
            })}
          </DayColumns>
        </ScheduleBody>
      </ScheduleInner>
    </ScheduleScroller>
  );
}

function EventEditor({
  draft,
  calendars,
  conflicts,
  onChange,
  onSave,
  onClose,
  onDelete,
  onDeleteSeries,
}: {
  draft: EventDraft;
  calendars: CalendarDefinition[];
  conflicts: CalendarEvent[];
  onChange: (draft: EventDraft) => void;
  onSave: (draft: EventDraft) => void;
  onClose: () => void;
  onDelete?: () => void;
  onDeleteSeries?: () => void;
}) {
  const patch = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) => onChange({ ...draft, [key]: value });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(draft);
  };
  return (
    <EditorBackdrop onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <EditorCard>
        <EditorHeader>
          <EditorHeading>{draft.id ? "Edit event" : "New event"}</EditorHeading>
          <IconButton title="Close" onClick={onClose}><Icon name="X" size={14} /></IconButton>
        </EditorHeader>
        <EditorForm onSubmit={submit}>
          <TitleInput
            autoFocus
            value={draft.title}
            onChange={(event) => patch("title", event.target.value)}
            placeholder="Event title, or “Lunch tomorrow at 1pm”"
          />
          {draft.seriesId && (
            <SeriesNotice>
              <span>Apply changes to</span>
              <SeriesScopeSelect
                value={draft.editScope}
                onChange={(event) => patch("editScope", event.target.value as EventDraft["editScope"])}
              >
                <option value="occurrence">This occurrence</option>
                <option value="future">This and future</option>
                <option value="series">Entire series</option>
              </SeriesScopeSelect>
            </SeriesNotice>
          )}
          {conflicts.length > 0 && (
            <ConflictNotice>
              Conflicts with {conflicts.slice(0, 2).map((event) => event.title).join(", ")}
              {conflicts.length > 2 ? ` and ${conflicts.length - 2} more` : ""}.
            </ConflictNotice>
          )}
          <EditorRow>
            <FieldIcon><ToneDot $tone={calendars.find((item) => item.id === draft.calendarId)?.tone ?? "accent"} /></FieldIcon>
            <RowSelect
              aria-label="Calendar"
              value={draft.calendarId}
              onChange={(event) => {
                const calendar = calendars.find((item) => item.id === event.target.value);
                onChange({ ...draft, calendarId: event.target.value, tone: calendar?.tone ?? draft.tone });
              }}
            >
              {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
            </RowSelect>
          </EditorRow>
          <EditorRow>
            <FieldIcon><Icon name="Calendar" size={14} /></FieldIcon>
            <DateRangeFields>
              <DateInput
                aria-label="Start date"
                type="date"
                value={draft.date}
                onChange={(event) => {
                  const date = event.target.value;
                  onChange({ ...draft, date, endDate: draft.endDate < date ? date : draft.endDate });
                }}
              />
              <RangeDash>–</RangeDash>
              <DateInput
                aria-label="End date"
                type="date"
                value={draft.endDate}
                min={draft.date}
                onChange={(event) => patch("endDate", event.target.value)}
              />
            </DateRangeFields>
          </EditorRow>
          <EditorRow>
            <FieldIcon><Icon name="Clock" size={14} /></FieldIcon>
            <FieldLabel>All-day</FieldLabel>
            <Toggle checked={draft.allDay} onChange={(value) => patch("allDay", value)} />
          </EditorRow>
          {!draft.allDay && (
            <EditorRow>
              <FieldIcon />
              <TimeInput type="time" value={draft.startTime} onChange={(event) => patch("startTime", event.target.value)} />
              <RangeDash>–</RangeDash>
              <TimeInput type="time" value={draft.endTime} onChange={(event) => patch("endTime", event.target.value)} />
            </EditorRow>
          )}
          <EditorRow>
            <FieldIcon />
            <RowSelect aria-label="Time zone" value={draft.timezone} onChange={(event) => patch("timezone", event.target.value)}>
              {TIMEZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone.replaceAll("_", " ")}</option>)}
            </RowSelect>
          </EditorRow>
          <EditorRow>
            <FieldIcon />
            <RowSelect
              aria-label="Repeat"
              value={draft.repeat}
              disabled={Boolean(draft.seriesId && draft.editScope === "occurrence")}
              onChange={(event) => patch("repeat", event.target.value as EventDraft["repeat"])}
            >
              <option value="none">Does not repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </RowSelect>
          </EditorRow>
          {draft.repeat !== "none" && (
            <>
              <EditorRow>
                <FieldIcon />
                <FieldLabel>Every</FieldLabel>
                <RecurrenceInterval
                  aria-label="Repeat interval"
                  type="number"
                  min={1}
                  max={99}
                  value={draft.repeatInterval}
                  disabled={Boolean(draft.seriesId && draft.editScope === "occurrence")}
                  onChange={(event) => patch("repeatInterval", Math.max(1, Number(event.target.value) || 1))}
                />
                <FieldSuffix>{draft.repeat === "daily" ? "day(s)" : draft.repeat === "weekly" ? "week(s)" : "month(s)"}</FieldSuffix>
              </EditorRow>
              {draft.repeat === "weekly" && (
                <EditorRow>
                  <FieldIcon />
                  <WeekdayPicker aria-label="Repeat on weekdays">
                    {["S", "M", "T", "W", "T", "F", "S"].map((label, day) => (
                      <WeekdayButton
                        key={`${label}-${day}`}
                        type="button"
                        $selected={draft.repeatWeekdays.includes(day)}
                        disabled={Boolean(draft.seriesId && draft.editScope === "occurrence")}
                        onClick={() => patch(
                          "repeatWeekdays",
                          draft.repeatWeekdays.includes(day)
                            ? draft.repeatWeekdays.filter((value) => value !== day)
                            : [...draft.repeatWeekdays, day].sort()
                        )}
                      >
                        {label}
                      </WeekdayButton>
                    ))}
                  </WeekdayPicker>
                </EditorRow>
              )}
              <EditorRow>
                <FieldIcon />
                <FieldLabel>Repeat until</FieldLabel>
                <DateInput
                  aria-label="Repeat until"
                  type="date"
                  min={draft.date}
                  value={draft.repeatUntil}
                  disabled={Boolean(draft.seriesId && draft.editScope === "occurrence")}
                  onChange={(event) => patch("repeatUntil", event.target.value)}
                />
              </EditorRow>
            </>
          )}
          <EditorRow>
            <FieldIcon><Icon name="MapPin" size={14} /></FieldIcon>
            <RowInput value={draft.location} onChange={(event) => patch("location", event.target.value)} placeholder="Add location" />
          </EditorRow>
          <EditorRow>
            <FieldIcon />
            <RowInput
              value={draft.attendees}
              onChange={(event) => patch("attendees", event.target.value)}
              placeholder="Invitees, comma separated"
            />
          </EditorRow>
          {draft.attendees.split(",").map((email) => email.trim().toLocaleLowerCase()).filter(Boolean).map((email) => (
            <AttendeeRow key={email}>
              <AttendeeEmail>{email}</AttendeeEmail>
              <AttendeeStatus
                aria-label={`RSVP status for ${email}`}
                value={draft.attendeeStatuses[email] ?? "pending"}
                onChange={(event) => patch("attendeeStatuses", {
                  ...draft.attendeeStatuses,
                  [email]: event.target.value as CalendarAttendee["status"],
                })}
              >
                <option value="pending">Pending</option>
                <option value="accepted">Accepted</option>
                <option value="tentative">Tentative</option>
                <option value="declined">Declined</option>
              </AttendeeStatus>
            </AttendeeRow>
          ))}
          <EditorRow>
            <FieldIcon><Icon name="Bell" size={14} /></FieldIcon>
            <RowSelect value={draft.reminderMinutes} onChange={(event) => patch("reminderMinutes", Number(event.target.value))}>
              <option value={-1}>No reminder</option>
              <option value={0}>At start time</option>
              <option value={5}>5 minutes before</option>
              <option value={10}>10 minutes before</option>
              <option value={30}>30 minutes before</option>
              <option value={60}>1 hour before</option>
              <option value={1440}>1 day before</option>
            </RowSelect>
          </EditorRow>
          <TonePicker aria-label="Event color">
            {(["accent", "green", "amber", "red", "blue"] as EventTone[]).map((tone) => (
              <ToneButton key={tone} type="button" $tone={tone} $selected={draft.tone === tone} onClick={() => patch("tone", tone)} aria-label={`${tone} color`}>
                <ToneDot $tone={tone} />
              </ToneButton>
            ))}
          </TonePicker>
          <NotesInput value={draft.notes} onChange={(event) => patch("notes", event.target.value)} placeholder="Notes" rows={3} />
          <EditorActions>
            <EditorDeleteActions>
              {onDelete && <Button type="button" $variant="ghost" $compact onClick={onDelete}>{draft.seriesId ? "Delete occurrence" : "Delete"}</Button>}
              {onDeleteSeries && <Button type="button" $variant="ghost" $compact onClick={onDeleteSeries}>Delete series</Button>}
            </EditorDeleteActions>
            <ToolbarGroup>
              <Button type="button" $variant="secondary" $compact onClick={onClose}>Cancel</Button>
              <Button type="submit" $variant="primary" $compact>{draft.id ? "Save" : "Create"}</Button>
            </ToolbarGroup>
          </EditorActions>
        </EditorForm>
      </EditorCard>
    </EditorBackdrop>
  );
}

const toneColor = (tone: EventTone) => {
  if (tone === "green") return t.status.connected;
  if (tone === "amber") return t.status.warning;
  if (tone === "red") return t.status.error;
  if (tone === "blue") return t.ansi.blue;
  return t.accent.primary;
};

const Root = styled.div`
  container-type: inline-size;
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  color: ${t.text.primary};
  background: ${t.bg.secondary};
`;

const TopBar = styled.div`
  flex: 0 0 auto;
  min-width: 0;
  min-height: 42px;
  padding: 0 ${EDITOR_SPACING.containerPadding};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  background: ${t.bg.tertiary};
  border-bottom: ${t.borderWidth} solid ${t.border};

  @container (max-width: 520px) {
    min-height: 0;
    padding-block: 6px;
    align-items: stretch;
    flex-direction: column;
    gap: 4px;
  }
`;

const ToolbarGroup = styled.div`
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 4px;

  @container (max-width: 520px) {
    width: 100%;

    &:last-child {
      overflow-x: auto;
      scrollbar-width: none;
    }

    &:last-child::-webkit-scrollbar { display: none; }
  }
`;

const CalendarTitle = styled.div`
  min-width: 0;
  margin-left: 4px;
  font-size: ${t.typography.md};
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  @container (max-width: 340px) {
    font-size: ${t.typography.base};
  }
`;

const SidebarToggle = styled(IconButton)`
  @container (max-width: 760px) { display: none; }
`;

const ViewSelect = styled(Select)`
  min-width: 84px;

  @container (max-width: 520px) {
    flex: 1 0 78px;
    min-width: 78px;
  }

  @container (max-width: 360px) { display: none; }
`;

const TodayButton = styled(Button)`
  white-space: nowrap;

  @container (max-width: 360px) { flex: 1; }
`;

const RangeNavigationButton = styled(IconButton)`
  @container (max-width: 360px) { display: none; }
`;

const CreateButton = styled.button`
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: ${t.radius};
  color: ${t.accent.text};
  background: ${t.accent.primary};
  cursor: pointer;
  &:hover { background: color-mix(in srgb, ${t.accent.primary} 82%, black); }
`;

const Workspace = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
`;

const Sidebar = styled.aside<{ $open: boolean }>`
  flex: 0 0 ${({ $open }) => ($open ? "224px" : "0")};
  width: ${({ $open }) => ($open ? "224px" : "0")};
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  opacity: ${({ $open }) => ($open ? 1 : 0)};
  transform: translateX(${({ $open }) => ($open ? "0" : "-8px")});
  visibility: ${({ $open }) => ($open ? "visible" : "hidden")};
  pointer-events: ${({ $open }) => ($open ? "auto" : "none")};
  background: ${t.bg.tertiary};
  border-right: ${({ $open }) => ($open ? t.borderWidth : "0")} solid ${t.border};
  transition:
    flex-basis 0.18s ease,
    width 0.18s ease,
    opacity 0.12s ease,
    transform 0.18s ease,
    border-right-width 0.18s ease,
    visibility 0s linear ${({ $open }) => ($open ? "0s" : "0.18s")};

  @media (prefers-reduced-motion: reduce) { transition: none; }
  @container (max-width: 760px) { display: none; }
`;

const MiniWrap = styled.div`
  padding: ${EDITOR_SPACING.containerPadding};
`;

const MiniHeader = styled.div`
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
`;

const MiniTitle = styled.div`
  flex: 1;
  min-width: 0;
  font-size: ${t.typography.base};
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const MiniNavGroup = styled.div`
  flex: 0 0 auto;
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
`;

const MiniNav = styled.button`
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: ${t.radius};
  color: ${t.text.muted};
  background: transparent;
  cursor: pointer;
  &:hover { color: ${t.text.primary}; background: ${t.bg.secondary}; }
`;

const MiniGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
`;

const MiniWeekday = styled.div`
  height: 20px;
  display: grid;
  place-items: center;
  font-size: ${t.typography.micro};
  color: ${t.text.muted};
  text-transform: uppercase;
`;

const MiniDay = styled.button<{ $outside: boolean; $inRange: boolean; $today: boolean; $selected: boolean }>`
  height: 24px;
  min-width: 0;
  display: grid;
  place-items: center;
  padding: 0;
  border: none;
  border-radius: ${t.radius};
  font-size: ${t.typography.sm};
  font-variant-numeric: tabular-nums;
  color: ${({ $outside }) => ($outside ? t.text.muted : t.text.primary)};
  opacity: ${({ $outside }) => ($outside ? 0.55 : 1)};
  background: ${({ $inRange }) => ($inRange ? t.bg.secondary : "transparent")};
  cursor: pointer;
  ${({ $today }) => $today && css`color: ${t.accent.text}; background: ${t.accent.primary}; opacity: 1;`}
  ${({ $selected, $today }) => $selected && !$today && css`box-shadow: inset 0 0 0 ${t.borderWidth} ${t.text.muted};`}
  &:hover { color: ${({ $today }) => ($today ? t.accent.text : t.text.primary)}; background: ${({ $today }) => ($today ? t.accent.primary : t.bg.elevated)}; }
`;

const CalendarListSection = styled.div`
  padding: 0 ${EDITOR_SPACING.containerPadding} 8px;
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const CalendarListRow = styled.div`
  min-width: 0;
  min-height: 28px;
  padding: 2px 3px;
  display: flex;
  align-items: center;
  gap: 7px;
`;

const CalendarListName = styled.span`
  flex: 1;
  min-width: 0;
  font-size: ${t.typography.base};
  color: ${t.text.secondary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const CalendarRemoveButton = styled.button`
  width: 18px;
  height: 18px;
  padding: 0;
  display: grid;
  place-items: center;
  border: none;
  border-radius: ${t.radius};
  color: ${t.text.muted};
  background: transparent;
  cursor: pointer;
  &:hover { color: ${t.text.primary}; background: ${t.bg.secondary}; }
`;

const CalendarCreatorRow = styled.div`
  min-width: 0;
  padding-top: 3px;
`;

const SidebarSection = styled.div`
  flex: 1;
  min-height: 0;
  padding: 4px ${EDITOR_SPACING.containerPadding} ${EDITOR_SPACING.containerPadding};
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SidebarHeading = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: ${t.typography.xs};
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: ${t.text.muted};
`;

const Count = styled.span`
  font-family: ${t.fontMono};
  font-size: ${t.typographyMono.micro};
`;

const UpcomingList = styled.div`
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
`;

const UpcomingRow = styled.button`
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 5px 6px;
  display: flex;
  align-items: flex-start;
  gap: 7px;
  border: none;
  border-radius: ${t.radius};
  text-align: left;
  color: ${t.text.primary};
  background: transparent;
  cursor: pointer;
  &:hover { background: ${t.bg.secondary}; }
`;

const UpcomingContent = styled.div`
  flex: 1;
  min-width: 0;
`;

const UpcomingTitle = styled.div`
  font-size: ${t.typography.base};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const UpcomingMeta = styled.div`
  margin-top: 2px;
  font-size: ${t.typography.micro};
  color: ${t.text.muted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const SidebarEmpty = styled.div`
  padding: 16px 6px;
  font-size: ${t.typography.sm};
  color: ${t.text.muted};
  text-align: center;
`;

const SidebarFooter = styled.div`
  min-width: 0;
  padding: 10px ${EDITOR_SPACING.containerPadding};
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: ${t.borderWidth} solid ${t.border};
`;

const HiddenFileInput = styled.input`
  display: none;
`;

const CalendarIdentity = styled.div`
  flex: 1;
  min-width: 0;
`;

const IdentityName = styled.div`
  font-size: ${t.typography.base};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const IdentityMeta = styled.div`
  font-size: ${t.typography.micro};
  color: ${t.text.muted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ToneDot = styled.span<{ $tone: EventTone }>`
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  margin-top: 4px;
  border-radius: 50%;
  background: ${({ $tone }) => toneColor($tone)};
`;

const CalendarCanvas = styled.main`
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: ${t.bg.secondary};
`;

const StandardCalendarView = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;

  @container (max-width: 360px) { display: none; }
`;

const CompactMonthShell = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: none;
  flex-direction: column;
  overflow-y: auto;
  background: ${t.bg.tertiary};

  @container (max-width: 360px) { display: flex; }
`;

const CompactAgenda = styled.div`
  min-width: 0;
  padding: 4px ${EDITOR_SPACING.containerPadding} ${EDITOR_SPACING.containerPadding};
`;

const CompactAgendaHeader = styled.div`
  min-width: 0;
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
`;

const CompactAgendaTitle = styled.div`
  min-width: 0;
  font-size: ${t.typography.xs};
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: ${t.text.muted};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const CompactEventRow = styled.button`
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 5px 6px;
  display: flex;
  align-items: flex-start;
  gap: 7px;
  border: none;
  border-radius: ${t.radius};
  text-align: left;
  color: ${t.text.primary};
  background: transparent;
  cursor: pointer;
  &:hover { background: ${t.bg.secondary}; }
`;

const CompactEmpty = styled.div`
  padding: 18px 6px;
  font-size: ${t.typography.sm};
  color: ${t.text.muted};
  text-align: center;
`;

const FilterBanner = styled.div`
  flex: 0 0 auto;
  min-height: 28px;
  padding: 4px ${EDITOR_SPACING.containerPadding};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: ${t.typography.sm};
  color: ${t.text.secondary};
  background: rgba(${t.accent.primaryRgb}, 0.12);
  border-bottom: ${t.borderWidth} solid ${t.border};

  @container (max-width: 420px) {
    font-size: ${t.typography.xs};
  }
`;

const BareTextButton = styled.button`
  padding: 2px 5px;
  border: none;
  border-radius: ${t.radius};
  color: ${t.text.muted};
  background: transparent;
  cursor: pointer;
  &:hover { color: ${t.text.primary}; background: ${t.bg.tertiary}; }
`;

const SearchBox = styled.div`
  width: min(220px, 30vw);
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  display: flex;
  align-items: center;
  gap: 5px;
  border: ${t.borderWidth} solid ${t.border};
  border-radius: ${t.radius};
  color: ${t.text.muted};
  background: ${t.bg.elevated};
  &:focus-within { border-color: color-mix(in srgb, ${t.border} 92%, white 8%); }

  @container (max-width: 520px) {
    flex: 1 0 132px;
    width: auto;
  }
`;

const SearchInput = styled.input`
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  outline: none;
  font: inherit;
  font-size: ${t.typography.base};
  color: ${t.text.primary};
  background: transparent;
  &::placeholder { color: ${t.text.muted}; }
`;

const BareButton = styled.button`
  width: 18px;
  height: 18px;
  padding: 0;
  display: grid;
  place-items: center;
  border: none;
  border-radius: ${t.radius};
  color: ${t.text.muted};
  background: transparent;
  cursor: pointer;
  &:hover { color: ${t.text.primary}; background: ${t.bg.tertiary}; }
`;

const MonthShell = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
`;

const MonthWeekdays = styled.div`
  flex: 0 0 28px;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border-bottom: ${t.borderWidth} solid ${t.border};
`;

const MonthWeekday = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 7px;
  font-size: ${t.typography.xs};
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: ${t.text.muted};

  @container (max-width: 420px) {
    justify-content: center;
    padding: 0 2px;
    font-size: ${t.typography.micro};
  }
`;

const MonthGrid = styled.div`
  flex: 1;
  min-height: 420px;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  grid-template-rows: repeat(6, minmax(70px, 1fr));

  @container (max-width: 420px) {
    min-height: 336px;
    grid-template-rows: repeat(6, minmax(56px, 1fr));
  }
`;

const MonthCell = styled.div<{ $outside: boolean; $selected: boolean; $inSelection: boolean }>`
  min-width: 0;
  min-height: 0;
  padding: 5px;
  overflow: hidden;
  border-right: ${t.borderWidth} solid ${t.border};
  border-bottom: ${t.borderWidth} solid ${t.border};
  color: ${({ $outside }) => ($outside ? t.text.muted : t.text.primary)};
  background: ${({ $outside }) => ($outside ? `color-mix(in srgb, ${t.bg.tertiary} 45%, ${t.bg.secondary})` : t.bg.secondary)};
  ${({ $selected }) => $selected && css`background: rgba(${t.accent.primaryRgb}, 0.08);`}
  ${({ $inSelection }) => $inSelection && css`background: rgba(${t.accent.primaryRgb}, 0.16);`}
  &:nth-child(7n) { border-right: none; }
  &:hover { background: ${t.bg.tertiary}; }
  &:focus-visible { outline: none; background: ${t.bg.tertiary}; }
  touch-action: none;

  @container (max-width: 420px) { padding: 3px 2px; }
`;

const MonthDayNumber = styled.div<{ $today: boolean }>`
  width: 22px;
  height: 22px;
  margin: 0 0 3px auto;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: ${t.typography.sm};
  font-variant-numeric: tabular-nums;
  ${({ $today }) => $today && css`color: ${t.accent.text}; background: ${t.accent.primary};`}

  @container (max-width: 420px) {
    width: 20px;
    height: 20px;
    margin-inline: auto;
    font-size: ${t.typography.micro};
  }
`;

const MonthEvents = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;

  @container (max-width: 420px) { gap: 1px; }
`;

const eventSurface = css<{ $tone: EventTone }>`
  color: ${t.text.primary};
  background: ${({ $tone }) => `color-mix(in srgb, ${toneColor($tone)} 17%, ${t.bg.secondary})`};
  border-left: 3px solid ${({ $tone }) => toneColor($tone)};
`;

const MonthEvent = styled.button<{ $tone: EventTone; $continuesBefore: boolean; $continuesAfter: boolean }>`
  ${eventSurface}
  width: 100%;
  min-width: 0;
  height: 22px;
  padding: 2px 5px;
  display: flex;
  align-items: center;
  gap: 4px;
  border-top: none;
  border-right: none;
  border-bottom: none;
  border-radius: ${t.radius};
  font-size: ${t.typography.sm};
  text-align: left;
  cursor: pointer;
  ${({ $continuesBefore }) => $continuesBefore && css`
    margin-left: -6px;
    padding-left: 7px;
    border-left-width: 0;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  `}
  ${({ $continuesAfter }) => $continuesAfter && css`
    width: calc(100% + 6px);
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  `}
  &:hover { filter: brightness(1.08); }

  @container (max-width: 420px) {
    height: 5px;
    padding: 0;
    border-left-width: 0;
    font-size: 0;
  }
`;

const MonthEventTime = styled.span`
  flex: 0 0 auto;
  font-size: ${t.typography.micro};
  color: ${t.text.muted};
  font-variant-numeric: tabular-nums;
`;

const EventTitle = styled.span`
  min-width: 0;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const MoreEvents = styled.div`
  padding-left: 7px;
  font-size: ${t.typography.micro};
  color: ${t.text.muted};

  @container (max-width: 420px) { display: none; }
`;

const AgendaShell = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: ${EDITOR_SPACING.containerPadding};
  overflow-y: auto;
  background: ${t.bg.tertiary};
`;

const AgendaDay = styled.section`
  min-width: 0;
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr);
  gap: 8px;
  margin-bottom: 12px;
`;

const AgendaDateButton = styled.button`
  align-self: start;
  padding: 5px;
  display: flex;
  flex-direction: column;
  align-items: center;
  border: none;
  border-radius: ${t.radius};
  color: ${t.text.muted};
  background: transparent;
  cursor: pointer;
  &:hover { color: ${t.text.primary}; background: ${t.bg.secondary}; }
`;

const AgendaWeekday = styled.span`
  font-size: ${t.typography.xs};
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;
`;

const AgendaNumber = styled.span`
  font-size: ${t.typography.lg};
  font-weight: 600;
  font-variant-numeric: tabular-nums;
`;

const AgendaEvents = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const AgendaEvent = styled.button`
  width: 100%;
  min-width: 0;
  min-height: 38px;
  padding: 6px 8px;
  display: flex;
  align-items: flex-start;
  gap: 7px;
  border: ${t.borderWidth} solid ${t.border};
  border-radius: ${t.radius};
  text-align: left;
  color: ${t.text.primary};
  background: ${t.bg.secondary};
  cursor: pointer;
  &:hover { border-color: color-mix(in srgb, ${t.text.muted} 35%, ${t.border}); }
`;

const AgendaEmpty = styled.div`
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  text-align: center;
`;

const ScheduleScroller = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: auto;
`;

const ScheduleInner = styled.div<{ $days: number }>`
  min-width: ${({ $days }) => ($days <= 3 ? "100%" : `${48 + $days * 88}px`)};
`;

const ScheduleHeader = styled.div`
  position: sticky;
  top: 0;
  z-index: 3;
  height: 46px;
  display: flex;
  background: ${t.bg.secondary};
  border-bottom: ${t.borderWidth} solid ${t.border};
`;

const Timezone = styled.div`
  flex: 0 0 62px;
  padding: 8px;
  align-self: flex-end;
  font-family: ${t.fontMono};
  font-size: ${t.typographyMono.micro};
  color: ${t.text.muted};
  text-align: right;

  @container (max-width: 420px) {
    flex-basis: 42px;
    padding-inline: 4px;
  }
`;

const DayHeaders = styled.div<{ $days: number }>`
  flex: 1;
  display: grid;
  grid-template-columns: repeat(${({ $days }) => $days}, ${({ $days }) => ($days <= 3 ? "minmax(0, 1fr)" : "minmax(88px, 1fr)")});
`;

const DayHeader = styled.div<{ $today: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-left: ${t.borderWidth} solid ${t.border};
  color: ${({ $today }) => ($today ? t.text.primary : t.text.secondary)};
`;

const DayName = styled.span`
  font-size: ${t.typography.xs};
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.3px;

  @container (max-width: 340px) { display: none; }
`;

const DayNumber = styled.span<{ $today: boolean }>`
  width: 23px;
  height: 23px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: ${t.typography.base};
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  ${({ $today }) => $today && css`color: ${t.accent.text}; background: ${t.accent.primary};`}
`;

const AllDayRow = styled.div`
  min-height: 34px;
  display: flex;
  border-bottom: ${t.borderWidth} solid ${t.border};
`;

const AllDayLabel = styled.div`
  flex: 0 0 62px;
  padding: 7px 8px;
  font-size: ${t.typography.micro};
  color: ${t.text.muted};
  text-align: right;

  @container (max-width: 420px) {
    flex-basis: 42px;
    padding-inline: 4px;
    overflow: hidden;
  }
`;

const AllDayColumns = styled.div<{ $days: number }>`
  flex: 1;
  display: grid;
  grid-template-columns: repeat(${({ $days }) => $days}, ${({ $days }) => ($days <= 3 ? "minmax(0, 1fr)" : "minmax(88px, 1fr)")});
`;

const AllDayCell = styled.div`
  min-width: 0;
  min-height: 33px;
  padding: 4px;
  border-left: ${t.borderWidth} solid ${t.border};
`;

const AllDayEvent = styled.button<{ $tone: EventTone }>`
  ${eventSurface}
  width: 100%;
  min-width: 0;
  height: 24px;
  padding: 2px 6px;
  display: flex;
  align-items: center;
  border-top: none;
  border-right: none;
  border-bottom: none;
  border-radius: ${t.radius};
  font-size: ${t.typography.sm};
  text-align: left;
  cursor: pointer;
`;

const ScheduleBody = styled.div`
  display: flex;
`;

const TimeRail = styled.div`
  flex: 0 0 62px;

  @container (max-width: 420px) { flex-basis: 42px; }
`;

const TimeLabel = styled.div`
  height: ${HOUR_HEIGHT}px;
  padding: 5px 8px 0 0;
  transform: translateY(-11px);
  font-family: ${t.fontMono};
  font-size: ${t.typographyMono.micro};
  color: ${t.text.muted};
  text-align: right;
  font-variant-numeric: tabular-nums;

  @container (max-width: 420px) {
    padding-right: 4px;
    font-size: ${t.typographyMono.micro};
  }
`;

const DayColumns = styled.div<{ $days: number }>`
  flex: 1;
  display: grid;
  grid-template-columns: repeat(${({ $days }) => $days}, ${({ $days }) => ($days <= 3 ? "minmax(0, 1fr)" : "minmax(88px, 1fr)")});
`;

const DayColumn = styled.div`
  position: relative;
  border-left: ${t.borderWidth} solid ${t.border};
`;

const TimeCell = styled.div`
  height: ${HOUR_HEIGHT}px;
  border-bottom: ${t.borderWidth} solid ${t.border};
  cursor: crosshair;
  &:hover { background: color-mix(in srgb, ${t.bg.tertiary} 55%, transparent); }
  &:focus-visible { outline: none; background: color-mix(in srgb, ${t.bg.tertiary} 75%, transparent); }
`;

const TimedEvent = styled.button<{ $tone: EventTone }>`
  ${eventSurface}
  position: absolute;
  z-index: 2;
  left: 3px;
  right: 4px;
  min-height: 24px;
  padding: 5px 6px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  border-top: none;
  border-right: none;
  border-bottom: none;
  border-radius: ${t.radius};
  font-size: ${t.typography.sm};
  text-align: left;
  overflow: hidden;
  cursor: pointer;
  &:hover { filter: brightness(1.08); }
`;

const TimeSelection = styled.div`
  position: absolute;
  z-index: 3;
  left: 3px;
  right: 4px;
  min-height: 24px;
  padding: 5px 6px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  overflow: hidden;
  border: ${t.borderWidth} solid ${t.accent.primary};
  border-radius: ${t.radius};
  color: ${t.text.primary};
  background: rgba(${t.accent.primaryRgb}, 0.18);
  pointer-events: none;
`;

const EventMeta = styled.span`
  max-width: 100%;
  margin-top: 2px;
  font-size: ${t.typography.micro};
  color: ${t.text.secondary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const NowLine = styled.div`
  position: absolute;
  z-index: 1;
  left: 0;
  right: 0;
  height: 1px;
  background: ${t.status.error};
  pointer-events: none;
`;

const NowDot = styled.span`
  position: absolute;
  left: -3px;
  top: -3px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: ${t.status.error};
`;

const EditorBackdrop = styled.div`
  position: absolute;
  z-index: 20;
  inset: 0;
  display: grid;
  place-items: center;
  padding: ${EDITOR_SPACING.containerPadding};
  background: color-mix(in srgb, ${t.bg.secondary} 72%, transparent);

  @container (max-width: 360px) {
    padding: 0;
    place-items: stretch;
    background: ${t.bg.elevated};
  }
`;

const EditorCard = styled.div`
  width: min(420px, 100%);
  max-height: 100%;
  overflow-y: auto;
  border: ${t.borderWidth} solid ${t.border};
  border-radius: calc(${t.radius} * 1.5);
  background: ${t.bg.elevated};
  box-shadow: ${t.shadowLg};

  @container (max-width: 360px) {
    width: 100%;
    height: 100%;
    max-height: none;
    border: none;
    border-radius: 0;
    box-shadow: none;
  }
`;

const EditorHeader = styled.div`
  height: 42px;
  padding: 0 ${EDITOR_SPACING.containerPadding};
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const EditorHeading = styled.div`
  font-size: ${t.typography.md};
  font-weight: 600;
`;

const EditorForm = styled.form`
  padding: 0 ${EDITOR_SPACING.containerPadding} ${EDITOR_SPACING.containerPadding};
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const TitleInput = styled(Input)`
  width: 100%;
  font-size: ${t.typography.lg};
  font-weight: 500;
`;

const SeriesNotice = styled.div`
  min-width: 0;
  min-height: 26px;
  padding: 4px 7px;
  display: flex;
  align-items: center;
  gap: 6px;
  border: ${t.borderWidth} solid ${t.border};
  border-radius: ${t.radius};
  font-size: ${t.typography.sm};
  color: ${t.text.secondary};
  background: ${t.bg.tertiary};
`;

const SeriesScopeSelect = styled(Select)`
  flex: 1;
  min-width: 0;
`;

const ConflictNotice = styled.div`
  min-width: 0;
  padding: 6px 8px;
  border: ${t.borderWidth} solid color-mix(in srgb, ${t.status.warning} 55%, ${t.border});
  border-radius: ${t.radius};
  font-size: ${t.typography.sm};
  color: ${t.status.warning};
  background: color-mix(in srgb, ${t.status.warning} 12%, transparent);
`;

const EditorRow = styled.div`
  min-width: 0;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const FieldIcon = styled.div`
  flex: 0 0 18px;
  display: grid;
  place-items: center;
  color: ${t.text.muted};
`;

const FieldLabel = styled.span`
  flex: 1;
  font-size: ${t.typography.base};
  color: ${t.text.secondary};
`;

const DateInput = styled(Input)`
  flex: 1;
  min-width: 0;
`;

const DateRangeFields = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;

  @container (max-width: 300px) {
    align-items: stretch;
    flex-direction: column;

    > span { display: none; }
  }
`;

const TimeInput = styled(Input)`
  flex: 1;
  min-width: 0;
`;

const RangeDash = styled.span`
  color: ${t.text.muted};
`;

const RowInput = styled(Input)`
  flex: 1;
  min-width: 0;
`;

const RowSelect = styled(Select)`
  flex: 1;
  min-width: 0;
`;

const AttendeeRow = styled.div`
  min-width: 0;
  padding-left: 26px;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const AttendeeEmail = styled.span`
  flex: 1;
  min-width: 0;
  font-size: ${t.typography.sm};
  color: ${t.text.secondary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const AttendeeStatus = styled(Select)`
  flex: 0 0 104px;
`;

const RecurrenceInterval = styled(Input)`
  flex: 0 0 56px;
  min-width: 0;
`;

const FieldSuffix = styled.span`
  min-width: 52px;
  font-size: ${t.typography.sm};
  color: ${t.text.muted};
`;

const WeekdayPicker = styled.div`
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(7, minmax(22px, 1fr));
  gap: 3px;
`;

const WeekdayButton = styled.button<{ $selected: boolean }>`
  min-width: 0;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: ${t.radius};
  font-size: ${t.typography.xs};
  color: ${({ $selected }) => ($selected ? t.accent.text : t.text.muted)};
  background: ${({ $selected }) => ($selected ? t.accent.primary : "transparent")};
  cursor: pointer;
  &:hover:not(:disabled) {
    color: ${({ $selected }) => ($selected ? t.accent.text : t.text.primary)};
    background: ${({ $selected }) => ($selected ? t.accent.primary : t.bg.tertiary)};
  }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const TonePicker = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 26px;
`;

const ToneButton = styled.button<{ $tone: EventTone; $selected: boolean }>`
  width: 24px;
  height: 24px;
  padding: 0;
  display: grid;
  place-items: center;
  border: ${t.borderWidth} solid ${({ $selected, $tone }) => ($selected ? toneColor($tone) : "transparent")};
  border-radius: ${t.radius};
  background: ${({ $selected }) => ($selected ? t.bg.tertiary : "transparent")};
  cursor: pointer;
  ${ToneDot} { margin: 0; width: 10px; height: 10px; }
  &:hover { background: ${t.bg.tertiary}; }
`;

const NotesInput = styled(TextArea)`
  width: 100%;
  resize: vertical;
`;

const EditorActions = styled.div`
  padding-top: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
`;

const EditorDeleteActions = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
`;

const StateView = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px 16px;
  color: ${t.text.muted};
  background: ${t.bg.tertiary};
  text-align: center;
`;

const StateTitle = styled.div`
  font-size: ${t.typography.md};
  font-weight: 500;
  color: ${t.text.primary};
`;

const StateText = styled.div`
  max-width: 360px;
  font-size: ${t.typography.sm};
  color: ${t.text.muted};
`;

const Spinner = styled.div`
  width: 20px;
  height: 20px;
  border: 2px solid ${t.border};
  border-top-color: ${t.accent.primary};
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { animation: none; }
`;
