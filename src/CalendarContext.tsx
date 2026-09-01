import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useCollabDoc, useCurrentUser } from "@soft-machine/sdk";

export type EventTone = "accent" | "green" | "amber" | "red" | "blue";
export type RecurrenceFrequency = "daily" | "weekly" | "monthly";

export interface EventRecurrence {
  frequency: RecurrenceFrequency;
  until: string;
  interval?: number;
  weekdays?: number[];
}

export interface CalendarAttendee {
  email: string;
  status: "pending" | "accepted" | "declined" | "tentative";
}

export interface CalendarDefinition {
  id: string;
  name: string;
  tone: EventTone;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  tone: EventTone;
  location: string;
  notes: string;
  reminderMinutes: number;
  calendarId?: string;
  timezone?: string;
  attendees?: CalendarAttendee[];
  seriesId?: string;
  recurrence?: EventRecurrence;
  createdAt: string;
  createdBy: string;
}

interface CalendarState {
  events: CalendarEvent[];
  calendars: CalendarDefinition[];
  ready: boolean;
  failed: boolean;
  generation: number;
  addEvent: (event: Omit<CalendarEvent, "id" | "createdAt" | "createdBy">) => CalendarEvent | null;
  addEvents: (events: Array<Omit<CalendarEvent, "id" | "createdAt" | "createdBy">>) => CalendarEvent[];
  updateEvent: (id: string, changes: Partial<CalendarEvent>) => void;
  deleteEvent: (id: string) => void;
  deleteSeries: (seriesId: string, from?: string) => void;
  updateSeries: (seriesId: string, changes: Partial<CalendarEvent>, from?: string) => void;
  addCalendar: (name: string, tone?: EventTone) => CalendarDefinition | null;
  updateCalendar: (id: string, changes: Partial<CalendarDefinition>) => void;
  deleteCalendar: (id: string) => void;
  duplicateEvent: (id: string) => CalendarEvent | null;
  clearEvents: () => void;
}

const CalendarContext = createContext<CalendarState | null>(null);
const LOCAL_ORIGIN = { plugin: "calendar" };

function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      "title" in value &&
      "start" in value &&
      "end" in value
  );
}

export function CalendarProvider({ children }: { children: ReactNode }) {
  const { doc, ready, failed } = useCollabDoc("workspace-events");
  const viewer = useCurrentUser();
  const mapRef = useRef<any>(null);
  const calendarMapRef = useRef<any>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<CalendarDefinition[]>([]);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!doc || !ready) return;
    const eventMap = doc.getMap("events");
    const calendarMap = doc.getMap("calendars");
    mapRef.current = eventMap;
    calendarMapRef.current = calendarMap;

    if (!calendarMap.has("default")) {
      doc.transact(() => {
        calendarMap.set("default", { id: "default", name: "Workspace", tone: "accent" });
      }, LOCAL_ORIGIN);
    }

    const sync = () => {
      const next = Array.from(eventMap.values()).filter(isCalendarEvent) as CalendarEvent[];
      next.sort((a, b) => a.start.localeCompare(b.start));
      setEvents(next);
      setGeneration((value) => value + 1);
    };

    const syncCalendars = () => {
      const next = Array.from(calendarMap.values()).filter(
        (value): value is CalendarDefinition => Boolean(value && typeof value === "object" && "id" in value && "name" in value)
      );
      setCalendars(next);
    };

    sync();
    syncCalendars();
    eventMap.observe(sync);
    calendarMap.observe(syncCalendars);
    return () => {
      eventMap.unobserve(sync);
      calendarMap.unobserve(syncCalendars);
      if (mapRef.current === eventMap) mapRef.current = null;
      if (calendarMapRef.current === calendarMap) calendarMapRef.current = null;
    };
  }, [doc, ready]);

  const addEvents = useCallback(
    (drafts: Array<Omit<CalendarEvent, "id" | "createdAt" | "createdBy">>) => {
      const eventMap = mapRef.current;
      if (!eventMap || !doc) return [];
      const createdAt = new Date().toISOString();
      const events = drafts.map((draft) => ({
        ...draft,
        id: makeId(),
        createdAt,
        createdBy: viewer?.name || "Workspace member",
      }));
      doc.transact(() => {
        events.forEach((event) => eventMap.set(event.id, event));
      }, LOCAL_ORIGIN);
      return events;
    },
    [doc, viewer?.name]
  );

  const addEvent = useCallback(
    (draft: Omit<CalendarEvent, "id" | "createdAt" | "createdBy">) => addEvents([draft])[0] ?? null,
    [addEvents]
  );

  const updateEvent = useCallback(
    (id: string, changes: Partial<CalendarEvent>) => {
      const eventMap = mapRef.current;
      const current = eventMap?.get(id);
      if (!eventMap || !doc || !isCalendarEvent(current)) return;
      doc.transact(() => eventMap.set(id, { ...current, ...changes, id }), LOCAL_ORIGIN);
    },
    [doc]
  );

  const deleteEvent = useCallback(
    (id: string) => {
      if (!mapRef.current || !doc) return;
      doc.transact(() => mapRef.current.delete(id), LOCAL_ORIGIN);
    },
    [doc]
  );

  const deleteSeries = useCallback(
    (seriesId: string, from?: string) => {
      const eventMap = mapRef.current;
      if (!eventMap || !doc) return;
      doc.transact(() => {
        Array.from(eventMap.entries()).forEach(([id, value]: [string, unknown]) => {
          if (isCalendarEvent(value) && value.seriesId === seriesId && (!from || value.start >= from)) eventMap.delete(id);
        });
      }, LOCAL_ORIGIN);
    },
    [doc]
  );

  const updateSeries = useCallback(
    (seriesId: string, changes: Partial<CalendarEvent>, from?: string) => {
      const eventMap = mapRef.current;
      if (!eventMap || !doc) return;
      doc.transact(() => {
        Array.from(eventMap.entries()).forEach(([id, value]: [string, unknown]) => {
          if (!isCalendarEvent(value) || value.seriesId !== seriesId || (from && value.start < from)) return;
          eventMap.set(id, { ...value, ...changes, id });
        });
      }, LOCAL_ORIGIN);
    },
    [doc]
  );

  const addCalendar = useCallback((name: string, tone: EventTone = "blue") => {
    const calendarMap = calendarMapRef.current;
    if (!calendarMap || !doc || !name.trim()) return null;
    const calendar = { id: makeId(), name: name.trim(), tone };
    doc.transact(() => calendarMap.set(calendar.id, calendar), LOCAL_ORIGIN);
    return calendar;
  }, [doc]);

  const updateCalendar = useCallback((id: string, changes: Partial<CalendarDefinition>) => {
    const calendarMap = calendarMapRef.current;
    const current = calendarMap?.get(id);
    if (!calendarMap || !doc || !current) return;
    doc.transact(() => calendarMap.set(id, { ...current, ...changes, id }), LOCAL_ORIGIN);
  }, [doc]);

  const deleteCalendar = useCallback((id: string) => {
    const calendarMap = calendarMapRef.current;
    if (!calendarMap || !doc || id === "default") return;
    doc.transact(() => {
      calendarMap.delete(id);
      Array.from(mapRef.current?.entries?.() ?? []).forEach(([eventId, value]: [string, unknown]) => {
        if (isCalendarEvent(value) && value.calendarId === id) {
          mapRef.current.set(eventId, { ...value, calendarId: "default" });
        }
      });
    }, LOCAL_ORIGIN);
  }, [doc]);

  const duplicateEvent = useCallback(
    (id: string) => {
      const current = mapRef.current?.get(id);
      if (!isCalendarEvent(current)) return null;
      const {
        id: _id,
        createdAt: _createdAt,
        createdBy: _createdBy,
        seriesId: _seriesId,
        recurrence: _recurrence,
        ...copy
      } = current;
      return addEvent({ ...copy, title: `${copy.title} (copy)` });
    },
    [addEvent]
  );

  const clearEvents = useCallback(() => {
    if (!mapRef.current || !doc) return;
    doc.transact(() => mapRef.current.clear(), LOCAL_ORIGIN);
  }, [doc]);

  const value = useMemo(
    () => ({
      events,
      calendars,
      ready,
      failed,
      generation,
      addEvent,
      addEvents,
      updateEvent,
      deleteEvent,
      deleteSeries,
      updateSeries,
      addCalendar,
      updateCalendar,
      deleteCalendar,
      duplicateEvent,
      clearEvents,
    }),
    [
      addEvent,
      addEvents,
      addCalendar,
      calendars,
      clearEvents,
      deleteCalendar,
      deleteEvent,
      deleteSeries,
      updateCalendar,
      updateSeries,
      duplicateEvent,
      events,
      failed,
      generation,
      ready,
      updateEvent,
    ]
  );

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

export function useCalendar() {
  const context = useContext(CalendarContext);
  if (!context) throw new Error("useCalendar must be used within CalendarProvider");
  return context;
}
