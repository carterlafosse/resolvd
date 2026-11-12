// One priority's SLA policy: response and resolution times in hours or days, saved together.
import { Button, Group, NumberInput, Paper, Select, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { slaKeys, updateSlaPolicy } from '../../api/sla.js';
import { PriorityBadge } from '../../components/PriorityBadge.jsx';
import { PRIORITIES } from '../../constants.js';
import classes from './SlaPolicyRow.module.css';
import { fromMinutes, policyErrors, toMinutes } from './slaUnits.js';

const UNIT_OPTIONS = [
  { value: 'hours', label: 'hours' },
  { value: 'days', label: 'days' },
];

// The page gives each row a key that includes updated_at, so after a save the row starts
// again from the saved values instead of keeping its own copy in sync.
export function SlaPolicyRow({ policy }) {
  // ----- State -----
  const [response, setResponse] = useState(() => fromMinutes(policy.response_minutes));
  const [resolution, setResolution] = useState(() => fromMinutes(policy.resolution_minutes));
  const [errors, setErrors] = useState({});

  // ----- Data -----
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (minutes) => updateSlaPolicy(policy.priority, minutes),
    onSuccess: () => {
      notifications.show({
        color: 'green',
        message: `${PRIORITIES[policy.priority].label} priority SLA saved`,
      });
      queryClient.invalidateQueries({ queryKey: slaKeys.all });
    },
    onError: (error) =>
      setErrors({
        response: error.fieldErrors?.responseMinutes,
        resolution: error.fieldErrors?.resolutionMinutes,
      }),
  });
  const responseMinutes = toMinutes(response.value, response.unit);
  const resolutionMinutes = toMinutes(resolution.value, resolution.unit);
  const isChanged =
    responseMinutes !== policy.response_minutes || resolutionMinutes !== policy.resolution_minutes;

  // ----- Handlers -----
  // Each field is { value, unit }; `part` says which half changed.
  const handleChange = (setField, part) => (next) => {
    setField((current) => ({ ...current, [part]: next }));
    setErrors({});
  };
  const handleSave = () => {
    const found = policyErrors(responseMinutes, resolutionMinutes);
    setErrors(found);
    if (Object.keys(found).length === 0) save.mutate({ responseMinutes, resolutionMinutes });
  };

  // ----- Render -----
  const renderDuration = (label, field, setField, error) => (
    <Group gap={6} align="flex-start" wrap="nowrap">
      <NumberInput
        className={classes.amountInput}
        label={label}
        value={field.value}
        onChange={handleChange(setField, 'value')}
        min={0}
        decimalScale={2}
        error={error}
      />
      <Select
        className={classes.unitSelect}
        label="Unit"
        aria-label={`${label} unit`}
        data={UNIT_OPTIONS}
        value={field.unit}
        onChange={handleChange(setField, 'unit')}
        allowDeselect={false}
      />
    </Group>
  );

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <PriorityBadge priority={policy.priority} size="md" />
        <Group gap="lg" align="flex-end" wrap="wrap">
          {renderDuration('First response within', response, setResponse, errors.response)}
          {renderDuration('Resolve within', resolution, setResolution, errors.resolution)}
          <Button onClick={handleSave} disabled={!isChanged} loading={save.isPending}>
            Save
          </Button>
        </Group>
        {isChanged && (
          <Text size="xs" c="dimmed">
            Not saved yet ({responseMinutes} and {resolutionMinutes} minutes).
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
