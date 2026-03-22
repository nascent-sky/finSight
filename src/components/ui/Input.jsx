import clsx from "clsx"

const Input = ({
  label,
  error,
  className,
  ...props
}) => {
  return (
    <div className="w-full space-y-1">
      {label && (
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {label}
        </label>
      )}

      <input
        className={clsx(
          "w-full rounded-lg border px-3 py-2 text-sm transition focus:outline-none focus:ring-2",
          "bg-white dark:bg-gray-900",
          "border-gray-300 dark:border-gray-700",
          "focus:ring-indigo-500",
          error && "border-red-500 focus:ring-red-400",
          className
        )}
        {...props}
      />

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}
    </div>
  )
}

export default Input
