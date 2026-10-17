/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React from "react";

export interface Client971LogoProps extends React.SVGProps<SVGSVGElement> {
    size?: number | string;
}

export function Client971Icon({ size = 24, width, height, className, ...props }: Client971LogoProps) {
    const w = width ?? size;
    const h = height ?? size;

    return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width={w} height={h} className={className} {...props}>
            <defs>
                <linearGradient id="971-client-mark" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stopColor="#43d9c3" />
                    <stop offset="1" stopColor="#7787ff" />
                </linearGradient>
            </defs>
            <rect width="1000" height="1000" rx="250" fill="#111521" />
            <text x="500" y="620" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize="440" fontWeight="800" letterSpacing="-28" fill="url(#971-client-mark)">971</text>
            <path d="M340 704h320" stroke="#f4f6ff" strokeWidth="18" strokeLinecap="round" opacity=".82" />
        </svg>
    );
}

export default Client971Icon;
