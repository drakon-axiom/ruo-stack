/* The single lucide import site. Keeping every icon reference funnelled through
 * here keeps the set tree-shaken and stops screens from each picking a
 * different glyph for the same concept. It also replaces the emoji the old UI
 * used as icons (✓ ○ ✕ ☀ ☾ ●), which screen readers announce unpredictably. */
export type { LucideIcon } from 'lucide-react';

export {
  // Brand-web navigation
  LayoutDashboard,
  Package,
  Truck,
  ShieldAlert,
  AlertTriangle,
  Users,
  BookUser,
  Wallet,
  Store,
  FlaskConical,
  FileCheck2,
  Palette,
  Ship,
  Calculator,
  MessagesSquare,
  Gift,
  UsersRound,
  Settings,
  // Admin-web navigation
  BarChart3,
  ListChecks,
  GitCompareArrows,
  ScrollText,
  Megaphone,
  Scale,
  ClipboardList,
  Inbox,
  // Chrome and controls
  Bell,
  Search,
  Menu,
  X,
  Check,
  Circle,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Plus,
  Sun,
  Moon,
  Monitor,
  LogOut,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Loader2,
  Lock,
} from 'lucide-react';
