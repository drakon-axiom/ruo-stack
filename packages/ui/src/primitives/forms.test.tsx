import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field } from './Field.js';
import { Input } from './Input.js';
import { Checkbox } from './Checkbox.js';

describe('form primitives', () => {
  it('Field associates its label with the control', () => {
    render(
      <Field label="Recipient name" htmlFor="rn">
        <Input id="rn" />
      </Field>,
    );
    expect(screen.getByLabelText('Recipient name')).toBeInTheDocument();
  });

  it('Field exposes an error to screen readers and marks the control invalid', () => {
    render(
      <Field label="Email" htmlFor="em" error="Required">
        <Input id="em" invalid />
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
    expect(input.getAttribute('aria-describedby')).toContain('em-error');
  });

  it('Input does not suppress the focus outline', () => {
    // The old .input class used outline-none with only a border-colour change,
    // leaving keyboard users no focus indication.
    render(<Input aria-label="x" />);
    expect(screen.getByLabelText('x')).not.toHaveClass('outline-none');
  });

  it('Checkbox toggles', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox checked={false} onCheckedChange={onCheckedChange} label="Remember me" />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Remember me' }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
