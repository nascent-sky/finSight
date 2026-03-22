import { NavLink } from "react-router-dom"
import {
  LayoutDashboard,
  Receipt,
  BarChart3,
  Tags,
  Settings,
} from "lucide-react"
import clsx from "clsx"
import BrandedHeader from "../common/BrandedHeader"
import { auth } from "../../firebase"

const navItems = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Expenses", path: "/expenses", icon: Receipt },
  { label: "Analytics", path: "/analytics", icon: BarChart3 },
  { label: "Categories", path: "/categories", icon: Tags },
  { label: "Settings", path: "/settings", icon: Settings },
]

const Sidebar = ({ isOpen, onClose, user }) => {
  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          "fixed left-0 top-0 z-50 h-full w-64",
          "bg-white dark:bg-gray-900",
          "border-r border-gray-200 dark:border-gray-800",
          "transform transition-transform duration-300",
          "md:translate-x-0 md:fixed md:z-50",
          "flex flex-col", // ✅ IMPORTANT
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center px-6 border-b border-gray-200 dark:border-gray-800">
          <BrandedHeader />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon

            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onClose} // ✅ closes sidebar on mobile
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                    isActive
                      ? "bg-indigo-600 text-white"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  )
                }
              >
                <Icon size={18} />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        {/* Bottom User Section */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-800">
          {user ? (
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {user.displayName || user.email}
              </p>
              <button
                onClick={() => {
                  auth.signOut()
                  onClose()
                }}
                className="text-red-500 text-sm mt-2"
              >
                Logout
              </button>
            </div>
          ) : (
            <NavLink
              to="/login"
              onClick={onClose}
              className="text-indigo-600 text-sm font-medium"
            >
              Login / Signup
            </NavLink>
          )}
        </div>
      </aside>
    </>
  )
}

export default Sidebar