/** Draws the shared checklist mark used by browser and Apple Home Screen icon routes. */
export function GroceryAppIcon() {
  return (
    <div
      style={{
        alignItems: "center",
        background: "#0f766e",
        display: "flex",
        height: "100%",
        justifyContent: "center",
        position: "relative",
        width: "100%"
      }}
    >
      <div
        style={{
          background: "#ffffff",
          borderRadius: "13%",
          display: "flex",
          flexDirection: "column",
          gap: "9%",
          height: "62%",
          justifyContent: "center",
          padding: "11%",
          width: "54%"
        }}
      >
        {["#0f766e", "#0f766e", "#0f766e"].map((color, index) => (
          <div key={index} style={{ alignItems: "center", display: "flex", gap: "12%", height: "16%" }}>
            <div style={{ background: color, borderRadius: "50%", height: "100%", width: "16%" }} />
            <div style={{ background: color, borderRadius: "999px", height: "46%", width: "72%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}
