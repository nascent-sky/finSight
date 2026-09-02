import clsx from "clsx"
import { NavLink } from "react-router-dom"
import { BarChart3, LayoutDashboard, PlusCircle, Receipt, Tags } from "lucide-react"

const BottomNav = ({ onAddClick }) => {
  return (
    <nav className="theme-card theme-border fixed bottom-0 left-0 right-0 z-40 h-[calc(4rem+env(safe-area-inset-bottom))] border-t pb-[env(safe-area-inset-bottom)] md:hidden">
      <div className="grid h-16 grid-cols-5 items-center px-2">
        <NavItem to="/" icon={LayoutDashboard} label="Home" />
        <NavItem to="/expenses" icon={Receipt} label="Expenses" />

        <button
          type="button"
          aria-label="Add transaction"
          onClick={onAddClick}
          className="theme-button-primary flex h-14 w-14 -translate-y-4 items-center justify-center justify-self-center rounded-full shadow-lg"
        >
          <PlusCircle size={28} />
        </button>

        <NavItem to="/analytics" icon={BarChart3} label="Stats" />
        <NavItem to="/categories" icon={Tags} label="Categories" />
      </div>
    </nav>
  )
}

const NavItem = ({ to, icon, label }) => {
  const IconComponent = icon

  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          "flex h-12 min-w-0 flex-col items-center justify-center gap-1 text-xs",
          isActive ? "theme-accent-text" : "theme-muted-text",
        )
      }
    >
      <IconComponent size={20} />
      {label}
    </NavLink>
  )
}

export default BottomNav
