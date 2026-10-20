import {
  Children,
  isValidElement,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

interface SelectOption {
  value: string;
  label: ReactNode;
  disabled: boolean;
}

interface AnimatedSelectProps {
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  style?: CSSProperties;
  disabled?: boolean;
  required?: boolean;
  'aria-label'?: string;
}

const collectOptions = (children: ReactNode): SelectOption[] => {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>(child)) return;
    if (child.type === 'option') {
      options.push({
        value: String(child.props.value ?? ''),
        label: child.props.children,
        disabled: Boolean(child.props.disabled),
      });
      return;
    }
    if (child.props.children) options.push(...collectOptions(child.props.children));
  });
  return options;
};

export const AnimatedSelect = ({
  value,
  onChange,
  children,
  style,
  disabled = false,
  required = false,
  'aria-label': ariaLabel,
}: AnimatedSelectProps) => {
  const listboxId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const options = useMemo(() => collectOptions(children), [children]);
  const normalizedValue = String(value);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === normalizedValue));
  const selectedOption = options[selectedIndex];

  const positionMenu = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportBottom = viewportTop + viewportHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const availableBelow = viewportBottom - rect.bottom;
    const availableAbove = rect.top - viewportTop;
    const estimatedHeight = Math.min(320, options.length * 44 + 12);
    const opensAbove = availableBelow < estimatedHeight && rect.top > availableBelow;
    const viewportPadding = 10;
    const width = Math.min(
      Math.max(rect.width, Math.min(180, viewportWidth - viewportPadding * 2)),
      viewportWidth - viewportPadding * 2,
    );
    const left = Math.min(
      Math.max(viewportLeft + viewportPadding, rect.left),
      viewportRight - width - viewportPadding,
    );
    const availableHeight = opensAbove ? availableAbove - 16 : availableBelow - 16;
    setMenuStyle({
      position: 'fixed',
      left,
      top: opensAbove
        ? Math.max(viewportTop + viewportPadding, rect.top - Math.min(estimatedHeight, availableHeight) - 6)
        : rect.bottom + 6,
      width,
      maxHeight: Math.max(96, Math.min(320, availableHeight)),
    });
  }, [options.length]);

  useEffect(() => {
    if (!isOpen) return;
    positionMenu();
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!buttonRef.current?.contains(target) && !(target instanceof Element && target.closest(`[data-select-menu="${listboxId}"]`))) {
        setIsOpen(false);
      }
    };
    const reposition = () => positionMenu();
    const visualViewport = window.visualViewport;
    document.addEventListener('pointerdown', close);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    visualViewport?.addEventListener('resize', reposition);
    visualViewport?.addEventListener('scroll', reposition);
    return () => {
      document.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      visualViewport?.removeEventListener('resize', reposition);
      visualViewport?.removeEventListener('scroll', reposition);
    };
  }, [isOpen, listboxId, positionMenu]);

  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    onChange({ target: { value: option.value } });
    setIsOpen(false);
    buttonRef.current?.focus();
  };

  const move = (direction: 1 | -1) => {
    if (!options.length) return;
    let next = activeIndex;
    do next = (next + direction + options.length) % options.length;
    while (options[next]?.disabled && next !== activeIndex);
    setActiveIndex(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setActiveIndex(selectedIndex);
        positionMenu();
        setIsOpen(true);
      }
      else move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Home' && isOpen) {
      event.preventDefault();
      setActiveIndex(options.findIndex((option) => !option.disabled));
      return;
    }
    if (event.key === 'End' && isOpen) {
      event.preventDefault();
      let lastEnabled = options.length - 1;
      while (lastEnabled >= 0 && options[lastEnabled]?.disabled) lastEnabled -= 1;
      setActiveIndex(lastEnabled);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && isOpen) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option);
      return;
    }
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div className="animated-select" style={{ width: style?.width ?? '100%' }}>
      <button
        ref={buttonRef}
        type="button"
        className="animated-select-trigger"
        style={style}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-required={required || undefined}
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        onClick={() => {
          if (!isOpen) {
            setActiveIndex(selectedIndex);
            positionMenu();
          }
          setIsOpen((open) => !open);
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="animated-select-value">{selectedOption?.label ?? 'Seleccionar'}</span>
        <ChevronDown className="animated-select-chevron" size={16} aria-hidden="true" />
      </button>
      {isOpen && createPortal(
        <div
          id={listboxId}
          data-select-menu={listboxId}
          className="animated-select-menu"
          role="listbox"
          aria-label={ariaLabel}
          style={menuStyle}
        >
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === normalizedValue}
              className={`animated-select-option ${index === activeIndex ? 'is-active' : ''}`}
              disabled={option.disabled}
              key={`${option.value}-${index}`}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {option.value === normalizedValue && <Check size={15} aria-hidden="true" />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};
