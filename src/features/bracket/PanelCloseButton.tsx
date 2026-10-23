/**
 * The × of a Bracket panel (notes, "?" box). A 28 px square with a tinted ground; on a phone the button around it
 * is a 44 px tap target, pulled out into the panel's padding so the header keeps its height.
 */
export function PanelCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      aria-label='Close'
      className='flex size-7 cursor-pointer items-center justify-center max-[700px]:-m-2 max-[700px]:size-11'
      onClick={onClose}
      type='button'
    >
      <span className='flex size-7 items-center justify-center rounded-xs bg-foreground/12 text-base font-bold'>
        ×
      </span>
    </button>
  );
}
