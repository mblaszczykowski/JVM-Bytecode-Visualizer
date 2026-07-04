export function App() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">JVM Bytecode Visualizer</h1>
        <p className="mt-1 text-sm text-slate-400">
          Wykonanie bajtkodu JVM krok po kroku — parser, disassembler i interpreter w przeglądarce.
        </p>
      </header>
    </div>
  );
}
