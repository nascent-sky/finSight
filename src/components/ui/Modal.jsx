import { X } from "lucide-react"
import clsx from "clsx"

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  className,
}) => {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal box */}
      <div
        className={clsx(
          "relative w-full max-w-md rounded-xl bg-white dark:bg-gray-900",
          "shadow-lg",
          "mx-4",
          className
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-800 px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  )
}

export default Modal
