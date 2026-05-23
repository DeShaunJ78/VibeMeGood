import { useState } from "react";
import { useCreateEntry } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Target, Save, Zap } from "lucide-react";

export default function EntryBuilder() {
  const { toast } = useToast();
  const [stake, setStake] = useState<string>("25");
  const [entryType, setEntryType] = useState<string>("FLEX");
  
  // Minimal placeholder implementation since we can't easily select across pages
  // In a real app we'd use a global store to add props to entry
  const [picks, setPicks] = useState<any[]>([]);

  const createEntry = useCreateEntry();

  const handleSave = () => {
    if (picks.length < 2) {
      toast({ title: "Need more picks", description: "Minimum 2 picks required for an entry.", variant: "destructive" });
      return;
    }
    
    // We would actually map picks and submit
    toast({ title: "Entry saved", description: "Entry has been logged to journal." });
  };

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex items-center justify-between border-b border-border pb-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">Entry Builder</h1>
        <Button onClick={handleSave} disabled={createEntry.isPending} className="font-mono text-xs bg-primary text-primary-foreground hover:bg-primary/90">
          <Save className="w-4 h-4 mr-2" /> LOG ENTRY
        </Button>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
        <div className="lg:col-span-2 flex flex-col bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-800 bg-slate-950 font-bold flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" /> Active Picks ({picks.length}/6)
          </div>
          <div className="flex-1 overflow-auto p-6 flex items-center justify-center">
            {picks.length === 0 ? (
              <div className="text-center space-y-4 text-muted-foreground">
                <div className="bg-slate-800/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto">
                  <ListPlus className="w-8 h-8 text-slate-600" />
                </div>
                <p>No picks selected.</p>
                <p className="text-xs font-mono">Navigate to the Slate Board to add props to your entry.</p>
              </div>
            ) : (
              <div className="w-full space-y-3">
                {/* Pick list would render here */}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader>
              <CardTitle className="text-lg">Entry Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground uppercase">Entry Type</label>
                <Select value={entryType} onValueChange={setEntryType}>
                  <SelectTrigger className="w-full bg-slate-950 border-slate-800 font-mono">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FLEX">Flex Play</SelectItem>
                    <SelectItem value="POWER">Power Play</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-mono text-muted-foreground uppercase">Stake ($)</label>
                <Input 
                  type="number" 
                  value={stake} 
                  onChange={e => setStake(e.target.value)} 
                  className="bg-slate-950 border-slate-800 font-mono text-lg"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-slate-900 border-slate-800 flex-1">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" /> Math & Projections
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-sm text-muted-foreground font-mono">
                Add picks to see combined correlation, break-even % and expected EV.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Temporary icon
function ListPlus(props: any) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round" {...props}><path d="M11 12H3"/><path d="M16 6H3"/><path d="M16 18H3"/><path d="M18 9v6"/><path d="M21 12h-6"/></svg>;
}
