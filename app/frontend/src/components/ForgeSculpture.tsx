/** A folded strip: one material, many possible forms. Original vector artwork. */
export default function ForgeSculpture({className = ''}: {className?: string}) {
  return <svg viewBox="0 0 400 340" fill="none" aria-hidden="true" className={`forge-sculpture ${className}`}>
    <g className="forge-guides" stroke="currentColor" strokeOpacity=".17" strokeWidth=".8">
      <path d="M25 277H375M65 40V302M335 40V302M25 72H375" strokeDasharray="3 6"/>
      <ellipse cx="200" cy="275" rx="148" ry="29"/>
      <path d="M46 65h14m-7-7v14M340 284h14m-7-7v14"/>
    </g>
    <g className="forge-fold">
      <path d="M74 254 178 60 259 60 155 254Z" fill="#252820"/>
      <path d="m178 60 54 26h82l-55-26Z" fill="#eef0dd" stroke="#252820" strokeWidth="1.5"/>
      <path d="m232 86 104 194h-81L151 86Z" fill="#d8ed6a" stroke="#252820" strokeWidth="1.5"/>
      <path d="m151 86 27-26 104 194-27 26Z" fill="#b2c255" stroke="#252820" strokeWidth="1.5"/>
      <path d="m74 254 81 0 100 26h-81Z" fill="#858d69" stroke="#252820" strokeWidth="1.5"/>
      <path d="m135 184 32-59 60 111-61-17Z" fill="#f6f5ef" stroke="#252820" strokeWidth="1.5"/>
      <path d="m166 219 61 17 13 24-87-25Z" fill="#252820"/>
    </g>
    <g fill="currentColor" opacity=".5" fontFamily="monospace" fontSize="9" letterSpacing="1.5">
      <text x="22" y="323">AF / FORM STUDY</text><text x="311" y="323">VOL. 02</text>
    </g>
  </svg>;
}
