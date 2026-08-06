import * as RSw from '@radix-ui/react-switch';

export function Switch({
  checked,
  onCheckedChange,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  id?: string;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-content">
      <RSw.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-6 w-10 shrink-0 rounded-pill border border-line bg-surface-3 transition-colors duration-fast data-[state=checked]:border-accent-solid data-[state=checked]:bg-accent-solid"
      >
        <RSw.Thumb className="block h-4 w-4 translate-x-1 rounded-full bg-white transition-transform duration-fast data-[state=checked]:translate-x-5" />
      </RSw.Root>
      {label}
    </label>
  );
}
