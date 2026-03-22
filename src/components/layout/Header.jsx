import { Menu, Plus } from "lucide-react"
import Button from "../ui/Button"
import BrandedHeader from "../common/BrandedHeader"

const Header = ({ title, onMenuClick, onAddClick }) => {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 shadow-sm">
      
      {/* Left: Menu + Brand */}
      <div className="flex items-center gap-4">
        {/* Mobile menu button */}
        <button
          onClick={onMenuClick}
          className="rounded-md p-2 hover:bg-gray-100 dark:hover:bg-gray-800 md:hidden transition-colors"
        >
          <Menu size={20} />
        </button>

        {/* Branded Header */}
        <div className="hidden sm:block">
          <BrandedHeader />
        </div>

        {/* Mobile Title */}
        <div className="sm:hidden">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {title}
          </h1>
        </div>
      </div>

      {/* Right: Quick Add Expense */}
      <Button
        size="sm"
        className="flex items-center gap-1"
        onClick={onAddClick}
      >
        <Plus size={16} />
        <span className="hidden sm:inline">Add</span>
      </Button>
    </header>
  )
}

export default Header
