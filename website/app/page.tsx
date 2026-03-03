"use client";

import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Problem from "@/components/Problem";
import ProductPreview from "@/components/ProductPreview";
import Features from "@/components/Features";
import Comparison from "@/components/Comparison";
import HowItWorks from "@/components/HowItWorks";
import Enterprise from "@/components/Enterprise";
import OpenSource from "@/components/OpenSource";
import FinalCTA from "@/components/FinalCTA";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#06080C] overflow-x-hidden">
      <Navbar />
      <Hero />
      <Problem />
      <ProductPreview />
      <Features />
      <Comparison />
      <HowItWorks />
      <Enterprise />
      <OpenSource />
      <FinalCTA />
      <Footer />
    </main>
  );
}
