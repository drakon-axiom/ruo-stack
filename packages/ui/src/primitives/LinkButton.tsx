import { Link, type LinkProps } from 'react-router-dom';
import type { LucideIcon } from '../icons.js';
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonStyles.js';

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
}

/** A router Link wearing Button's clothes. Navigation actions must stay real
 *  links — middle-click, open-in-new-tab and copy-link-address all break if a
 *  navigation is faked with a button and navigate(). */
export function LinkButton({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {Icon && <Icon aria-hidden className="h-4 w-4" />}
      {children}
    </Link>
  );
}
