import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  Receipt,
  PlusCircle,
  BarChart3,
  Tags,
} from "lucide-react"
import clsx from "clsx"

const BottomNav = ({ onAddClick }) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 md:hidden">
      <div className="flex items-center justify-around py-2">
        
        <NavItem to="/" icon={LayoutDashboard} label="Home" />
        <NavItem to="/expenses" icon={Receipt} label="Expenses" />

        {/* Center Add Button */}
        <button
          onClick={onAddClick}
          className="flex -translate-y-4 flex-col items-center justify-center rounded-full bg-indigo-600 p-3 text-white shadow-lg"
        >
          <PlusCircle size={28} />
        </button>

        <NavItem to="/analytics" icon={BarChart3} label="Stats" />
        <NavItem to="/categories" icon={Tags} label="Categories" />
      </div>
    </nav>
  )
}

const NavItem = ({ to, icon: Icon, label }) => {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        clsx(
          "flex flex-col items-center gap-1 text-xs",
          isActive
            ? "text-indigo-600"
            : "text-gray-500 dark:text-gray-400"
        )
      }
    >
      <Icon size={20} />
      {label}
    </NavLink>
  )
}

export default BottomNav
