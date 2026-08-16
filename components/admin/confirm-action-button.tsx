"use client";

type ConfirmActionButtonProps = {
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
  className: string;
  message: string;
};

export function ConfirmActionButton({ action, children, className, message }: ConfirmActionButtonProps) {
  return (
    <button
      className={className}
      formAction={action}
      onClick={(event) => {
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
      type="submit"
    >
      {children}
    </button>
  );
}
