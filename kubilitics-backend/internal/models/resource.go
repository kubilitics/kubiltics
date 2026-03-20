package models

import (
	"time"
)

// Resource represents a generic Kubernetes resource
type Resource struct {
	ID          string                 `json:"id"`
	Kind        string                 `json:"kind"`
	APIVersion  string                 `json:"apiVersion"`
	Namespace   string                 `json:"namespace"`
	Name        string                 `json:"name"`
	UID         string                 `json:"uid"`
	Labels      map[string]string      `json:"labels"`
	Annotations map[string]string      `json:"annotations"`
	Metadata    map[string]interface{} `json:"metadata"`
	Spec        map[string]interface{} `json:"spec"`
	Status      map[string]interface{} `json:"status"`
	CreatedAt   time.Time              `json:"created_at"`
}

// ResourceList represents a list of resources
type ResourceList struct {
	Kind       string     `json:"kind"`
	APIVersion string     `json:"apiVersion"`
	Items      []Resource `json:"items"`
	Total      int        `json:"total"`
}

// ResourceHistory tracks resource changes over time
type ResourceHistory struct {
	ID           string    `json:"id" db:"id"`
	ResourceType string    `json:"resource_type" db:"resource_type"`
	Namespace    string    `json:"namespace" db:"namespace"`
	Name         string    `json:"name" db:"name"`
	Action       string    `json:"action" db:"action"` // created, updated, deleted
	YAML         string    `json:"yaml" db:"yaml"`
	Timestamp    time.Time `json:"timestamp" db:"timestamp"`
}
