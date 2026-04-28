import React, { useState } from 'react';

// existing imports

const App = () => {
    // existing state and logic

    const [collapsedTerms, setCollapsedTerms] = useState({});

    return (
        <div>
            {/* existing components */}
            <ReportablePanelView collapsedTerms={collapsedTerms} setCollapsedTerms={setCollapsedTerms} />
        </div>
    );
};

const ReportablePanelView = ({ collapsedTerms, setCollapsedTerms }) => {
    return (
        <div>
            {/* existing components */}
            {data.map(def => (
                <div key={def.id}>
                    <button onClick={() => setCollapsedTerms(c => ({ ...c, [def.id]: !c[def.id] }))}> 
                        {collapsedTerms[def.id] ? '▼' : '▲'} Terminal
                    </button>
                    {!collapsedTerms[def.id] && ( 
                        <div className="term-output">
                            {/* terminal output contents */}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

export default App;