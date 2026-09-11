export interface StudyPoint { day:number; population:number; claims:number; food:number; foodLevel:number; logisticsLevel:number; starvation:number; projects:number }
export interface StudyAlternative { plan:string; score:number; minReserveDays:number; netFood:number; claims:number; feasible:boolean }
export interface StudyDecision { day:number; plan:string; reason:string; alternatives:StudyAlternative[] }
export interface StudyResult { policy:string; initialDay:number; points:StudyPoint[]; decisions:StudyDecision[]; elapsedMs:number; projections:number; simulatedDays:number; maxDecisionMs:number }
export interface StudyScenario { id:string; label:string; description:string; results:StudyResult[] }
export interface PlannerStudyReport { version:1; generatedAt:string; library:string; recommendation:string; scenarios:StudyScenario[] }
