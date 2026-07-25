import { Select } from "@base-ui/react/select";

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export function Dropdown({
  value,
  options,
  onValueChange,
  ariaLabel,
  className = "",
  id,
  placeholder,
}: {
  value: string;
  options: DropdownOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  id?: string;
  placeholder?: string;
}) {
  return (
    <Select.Root
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
    >
      <Select.Trigger
        id={id}
        className={`select-trigger ${className}`.trim()}
        aria-label={ariaLabel}
      >
        <Select.Value placeholder={placeholder} />
        <Select.Icon className="select-icon" aria-hidden="true">
          <svg viewBox="0 0 12 12">
            <path d="m2.5 4.5 3.5 3 3.5-3" />
          </svg>
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="select-positioner"
          sideOffset={6}
          alignItemWithTrigger={false}
        >
          <Select.Popup className="select-popup">
            <Select.List className="select-list">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  className="select-item"
                  value={option.value}
                  disabled={option.disabled}
                >
                  <Select.ItemIndicator className="select-item-check">
                    <svg viewBox="0 0 12 12" aria-hidden="true">
                      <path d="m2 6.5 2.5 2.5L10 3.5" />
                    </svg>
                  </Select.ItemIndicator>
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
