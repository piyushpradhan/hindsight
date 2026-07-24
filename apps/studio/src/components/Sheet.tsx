import type { ReactNode } from "react";
import { motion } from "motion/react";

interface Props {
  onClose: () => void;
  children: ReactNode;
}

/** A dialog surface that materializes — scrim fades, card arrives with blur +
 *  scale together (reads as a real surface, not a plain fade), and exits along
 *  the same path. Wrap the render site in <AnimatePresence> for the exit. */
export function Sheet({ onClose, children }: Props) {
  return (
    <motion.div
      className="modal-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <motion.div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{ transformOrigin: "top center" }}
        initial={{ opacity: 0, y: -14, scale: 0.96, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -10, scale: 0.98, filter: "blur(6px)" }}
        transition={{ type: "spring", bounce: 0.16, duration: 0.42 }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
