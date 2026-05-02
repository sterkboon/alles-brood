import { SignIn } from "@clerk/react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        afterSignInUrl={`${basePath}/dashboard`}
        appearance={{
          variables: {
            colorPrimary: "hsl(25, 65%, 42%)",
            colorBackground: "hsl(33, 25%, 97%)",
            colorText: "hsl(25, 20%, 15%)",
            fontFamily: "Inter, system-ui, sans-serif",
            borderRadius: "0.5rem",
          },
          elements: {
            card: "shadow-md border border-border",
            headerTitle: "text-foreground font-bold",
            headerSubtitle: "text-muted-foreground",
            socialButtonsBlockButton: "border border-border hover:bg-accent",
          },
          layout: {
            logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
          },
        }}
      />
    </div>
  );
}
