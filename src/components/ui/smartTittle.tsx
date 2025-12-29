"use client";
import Link from "next/link";
import { useState } from "react";

interface SmartTitleProps {
  text: string;
  length?: number;
}

const SmartTitle = ({ text, length = 30 }: SmartTitleProps) => {
  const [showLess, setShowLess] = useState(true);

  if (text?.length < length) {
    return <p>{text}</p>;
  }

  return (
    <>
      <span className="p-tittle-md">
        {showLess ? `${text?.slice(0, length)}...` : text}
      </span>
      <Link
        href="#"
        style={{ color: "var(--text-color)", cursor: "pointer" }}
        onClick={() => setShowLess(!showLess)}
      ></Link>
    </>
  );
};

export default SmartTitle;
