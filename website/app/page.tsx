"use client";

import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import PreviewVideo from "@/components/PreviewVideo";
import Features from "@/components/Features";
import HowItWorks from "@/components/HowItWorks";
import Installation from "@/components/Installation";
import Security from "@/components/Security";
import FinalCTA from "@/components/FinalCTA";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--bg-primary)] overflow-x-hidden">
      <Navbar />
      <Hero />
      <PreviewVideo />
      <div className="section-divider" />
      <Features />
      <HowItWorks />
      <div className="section-divider" />
      <Installation />
      <Security />
      <div className="section-divider" />
      <FinalCTA />
      <Footer />
    </main>
  );
}
