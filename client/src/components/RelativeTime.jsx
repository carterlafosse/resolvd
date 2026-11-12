// A relative date ("3 hours ago") with the full date and time in a tooltip.
import { Text, Tooltip } from '@mantine/core';
import { fromNow, fullDate } from '../dates.js';

export function RelativeTime({ date, prefix, size = 'sm', c }) {
  // ----- State -----
  // none

  // ----- Data -----
  // none

  // ----- Handlers -----
  // none

  // ----- Render -----
  if (!date) return null;
  return (
    <Tooltip label={fullDate(date)} withArrow>
      <Text component="time" dateTime={new Date(date).toISOString()} size={size} c={c} span>
        {prefix ? `${prefix} ${fromNow(date)}` : fromNow(date)}
      </Text>
    </Tooltip>
  );
}
