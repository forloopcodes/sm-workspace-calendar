import { CalendarProvider } from "./CalendarContext";
import { CalendarPanel } from "./panels/CalendarPanel";

export function CalendarRoot() {
  return (
    <CalendarProvider>
      <CalendarPanel />
    </CalendarProvider>
  );
}
