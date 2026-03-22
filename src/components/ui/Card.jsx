import clsx from "clsx"

const Card = ({
  children,
  className,
  padding = "md",
}) => {
  const paddingClass = {
    sm: "p-3",
    md: "p-4",
    lg: "p-6",
    xl: "p-8",
  }[padding] || "p-4"

  return (
    <div
      className={clsx(
        "rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-md overflow-hidden",
        paddingClass,
        className
      )}
    >
      {children}
    </div>
  )
}

export default Card
