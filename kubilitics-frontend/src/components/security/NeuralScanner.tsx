import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';

interface NeuralScannerProps {
    statusText?: string;
    subText?: string;
}

export const NeuralScanner: React.FC<NeuralScannerProps> = ({
    statusText = "Initializing Security Shield",
    subText = "Aggregating cluster-wide security telemetry..."
}) => {
    // Generate random "neural" nodes
    const nodes = useMemo(() => Array.from({ length: 12 }).map((_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        delay: Math.random() * 2,
        size: 4 + Math.random() * 6
    })), []);

    return (
        <div className="relative h-[400px] w-full flex flex-col items-center justify-center overflow-hidden">
            {/* Background Neural Grid */}
            <div className="absolute inset-0 opacity-20 pointer-events-none">
                <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {nodes.map((node, i) => (
                        <React.Fragment key={i}>
                            {nodes.slice(i + 1).map((target, j) => (
                                <motion.line
                                    key={`${i}-${j}`}
                                    x1={node.x}
                                    y1={node.y}
                                    x2={target.x}
                                    y2={target.y}
                                    stroke="#326CE5"
                                    strokeWidth="0.1"
                                    initial={{ opacity: 0 }}
                                    animate={{
                                        opacity: [0, 0.4, 0],
                                    }}
                                    transition={{
                                        duration: 3 + Math.random() * 2,
                                        repeat: Infinity,
                                        delay: Math.random() * 5
                                    }}
                                />
                            ))}
                            <motion.circle
                                cx={node.x}
                                cy={node.y}
                                r={node.size / 20}
                                fill="#326CE5"
                                initial={{ opacity: 0, scale: 0 }}
                                animate={{
                                    opacity: [0, 0.8, 0],
                                    scale: [0, 1.2, 0]
                                }}
                                transition={{
                                    duration: 4,
                                    repeat: Infinity,
                                    delay: node.delay
                                }}
                            />
                        </React.Fragment>
                    ))}
                </svg>
            </div>

            {/* Central Shield Orb */}
            <div className="relative">
                <motion.div
                    animate={{
                        scale: [1, 1.05, 1],
                        rotate: [0, 5, -5, 0]
                    }}
                    transition={{
                        duration: 6,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                    className="relative z-10"
                >
                    <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#326CE5] to-blue-400 p-[2px] shadow-[0_0_50px_rgba(50,108,229,0.3)]">
                        <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center backdrop-blur-xl">
                            <Shield className="w-10 h-10 text-[#326CE5] drop-shadow-[0_0_8px_rgba(50,108,229,0.8)]" />
                        </div>
                    </div>
                </motion.div>

                {/* Outer Glowing Rings */}
                {[1, 1.2, 1.5].map((scale, i) => (
                    <motion.div
                        key={i}
                        initial={{ scale: 1, opacity: 0.5 }}
                        animate={{
                            scale: scale + 0.5,
                            opacity: 0
                        }}
                        transition={{
                            duration: 3,
                            repeat: Infinity,
                            delay: i * 0.8,
                            ease: "easeOut"
                        }}
                        className="absolute top-0 left-0 w-24 h-24 rounded-full border border-[#326CE5]/30 z-0"
                    />
                ))}
            </div>

            {/* Status Text */}
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                className="mt-12 text-center z-20"
            >
                <h3 className="text-2xl font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-[#326CE5] to-blue-400">
                    {statusText}
                </h3>
                <p className="text-slate-400 font-medium mt-2 max-w-md mx-auto">
                    {subText}
                </p>
            </motion.div>
        </div>
    );
};
