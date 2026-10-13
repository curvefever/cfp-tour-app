import type { ComponentProps } from 'react';
import { Field } from '../../components/ui';
import { EditingTag } from './EditingTag';
import { fieldOfControl } from './presence.shared';

/** A form `Field` whose label also shows who else is editing its control (named by `htmlFor`, the control's id). */
export function PresenceField({ label, ...props }: ComponentProps<typeof Field>) {
  const field = fieldOfControl(props.htmlFor);
  return (
    <Field
      {...props}
      label={
        <>
          {label}
          {field ? <EditingTag field={field} /> : null}
        </>
      }
    />
  );
}
