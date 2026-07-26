import React, { useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';

const THRESHOLD = 70;

export default function PullToRefresh({ onRefresh, children }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const containerRef = useRef(null);

  function handleTouchStart(e) {
    if (containerRef.current && containerRef.current.scrollTop <= 0 && !refreshing) {
      startY.current = e.touches[0].clientY;
    } else {
      startY.current = null;
    }
  }

  function handleTouchMove(e) {
    if (startY.current === null) return;
    const diff = e.touches[0].clientY - startY.current;
    if (diff > 0) {
      setPull(Math.min(diff, 100));
    }
  }

  async function handleTouchEnd() {
    if (pull > THRESHOLD && !refreshing) {
      setRefreshing(true);
      setPull(THRESHOLD);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPull(0);
      }
    } else {
      setPull(0);
    }
    startY.current = null;
  }

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="flex items-center justify-center overflow-hidden transition-all"
        style={{ height: pull, opacity: pull / THRESHOLD }}
      >
        <Loader2 size={22} className={`text-neutral-500 ${refreshing ? 'animate-spin' : ''}`} />
      </div>
      {children}
    </div>
  );
}